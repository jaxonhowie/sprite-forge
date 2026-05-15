import asyncio
import json
from pathlib import Path
from typing import Optional, Callable, Awaitable
import time

import numpy as np
from PIL import Image

from .models import (
    JobStatus,
    JobProgress,
    CreateJobRequest,
    CreateImageJobRequest,
    CreateFrameAssemblyJobRequest,
    FrameOffset,
)
from . import store
from .media.extract import extract_frame_with_retry
from .media.inpaint import build_mask, inpaint_frame
from .media.lighting import estimate_target_lighting, normalize_frame_lighting
from .media.remove_bg import remove_background, preload_model
from .media.pack import pack_grid


def _load_frame_arrays(frames_dir: Path) -> list[np.ndarray]:
    frames: list[np.ndarray] = []
    for frame_path in sorted(frames_dir.glob("*.png")):
        with Image.open(frame_path) as image:
            if image.mode == "RGBA":
                frame_array = np.array(image)
            else:
                frame_array = np.array(image.convert("RGB"))
        frames.append(frame_array)

    return frames


def _build_job_result(job_id: str, version: Optional[str] = None) -> dict:
    suffix = f"?v={version}" if version else ""
    frame_urls = []
    frames_dir = store.JOBS_DIR / job_id / "frames"
    for frame_path in sorted(frames_dir.glob("*.png")):
        frame_urls.append(f"/files/jobs/{job_id}/frames/{frame_path.name}{suffix}")

    return {
        "spritesheet_url": f"/files/jobs/{job_id}/spritesheet.png{suffix}",
        "json_url": f"/files/jobs/{job_id}/spritesheet.json{suffix}",
        "frame_urls": frame_urls,
    }


def _write_job_outputs(
    job_id: str,
    job_dir: Path,
    frames: list[np.ndarray],
    actual_timestamps: list[int],
    cols: int,
    padding: int,
    version: Optional[str] = None,
) -> dict:
    frames_dir = job_dir / "frames"
    frames_dir.mkdir(exist_ok=True)
    for frame_path in frames_dir.glob("*.png"):
        frame_path.unlink()

    sheet, meta = pack_grid(
        frames,
        cols=cols,
        padding=padding,
    )
    for i, frame_meta in enumerate(meta["frames"]):
        frame_meta["name"] = f"sprite_{i:04d}.png"
        frame_meta["ts_ms"] = actual_timestamps[i] if i < len(actual_timestamps) else 0
    meta["animation"] = {
        "fps": 12,
        "loop": True,
        "frames": [frame["name"] for frame in meta["frames"]],
    }

    sheet_path = job_dir / "spritesheet.png"
    sheet.save(str(sheet_path))

    for i, frame in enumerate(frames):
        frame_path = frames_dir / f"{i:04d}.png"
        if frame.ndim == 3 and frame.shape[2] == 4:
            Image.fromarray(frame, "RGBA").save(str(frame_path))
        elif frame.ndim == 3 and frame.shape[2] == 3:
            Image.fromarray(frame, "RGB").save(str(frame_path))
        else:
            Image.fromarray(frame).save(str(frame_path))

    meta_path = job_dir / "spritesheet.json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    return _build_job_result(job_id, version)


def _build_image_job_result(job_id: str, version: Optional[str] = None) -> dict:
    suffix = f"?v={version}" if version else ""
    items_dir = store.IMAGE_JOBS_DIR / job_id / "items"
    manifest_path = store.IMAGE_JOBS_DIR / job_id / "manifest.json"
    item_urls: list[str] = []
    if manifest_path.exists():
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)
        for item in manifest.get("items", []):
            item_name = item.get("name")
            if not isinstance(item_name, str):
                continue
            if (items_dir / item_name).exists():
                item_urls.append(f"/files/image_jobs/{job_id}/items/{item_name}{suffix}")
    else:
        item_urls = [
            f"/files/image_jobs/{job_id}/items/{item_path.name}{suffix}"
            for item_path in sorted(items_dir.glob("*.png"))
        ]

    return {
        "spritesheet_url": f"/files/image_jobs/{job_id}/spritesheet.png{suffix}",
        "json_url": f"/files/image_jobs/{job_id}/spritesheet.json{suffix}",
        "manifest_url": f"/files/image_jobs/{job_id}/manifest.json{suffix}",
        "item_urls": item_urls,
    }


def _write_image_job_outputs(
    job_id: str,
    job_dir: Path,
    items: list[np.ndarray],
    boxes: list[dict[str, int]],
    image_size: tuple[int, int],
    cols: int,
    padding: int,
    version: Optional[str] = None,
) -> dict:
    items_dir = job_dir / "items"
    items_dir.mkdir(exist_ok=True)
    for item_path in items_dir.glob("*.png"):
        item_path.unlink()

    sheet, meta = pack_grid(items, cols=cols, padding=padding)
    for index, frame_meta in enumerate(meta["frames"]):
        frame_meta["name"] = f"item_{index:04d}.png"
        frame_meta["source_box"] = boxes[index] if index < len(boxes) else None

    sheet_path = job_dir / "spritesheet.png"
    sheet.save(str(sheet_path))

    for index, item in enumerate(items):
        item_path = items_dir / f"{index:04d}.png"
        Image.fromarray(item, "RGBA").save(str(item_path))

    meta_path = job_dir / "spritesheet.json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    manifest = {
        "source_image": {
            "w": image_size[0],
            "h": image_size[1],
        },
        "items": [
            {
                "index": index,
                "name": f"{index:04d}.png",
                "box": boxes[index],
            }
            for index in range(len(boxes))
        ],
    }
    manifest_path = job_dir / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    return _build_image_job_result(job_id, version)


def _load_image_job_boxes(job_dir: Path, item_names: list[str]) -> tuple[list[str], list[dict[str, int]]]:
    manifest_path = job_dir / "manifest.json"
    if not manifest_path.exists():
        raise ValueError("切图清单不存在")

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    boxes_by_name: dict[str, dict[str, int]] = {}
    for item in manifest.get("items", []):
        item_name = item.get("name")
        box = item.get("box")
        if isinstance(item_name, str) and isinstance(box, dict):
            boxes_by_name[item_name] = box

    valid_item_names: list[str] = []
    boxes: list[dict[str, int]] = []
    for item_name in item_names:
        box = boxes_by_name.get(item_name)
        if box is None:
            continue
        valid_item_names.append(item_name)
        boxes.append(box)

    return valid_item_names, boxes


def _apply_frame_offset(frame: np.ndarray, x_offset: int, y_offset: int) -> np.ndarray:
    if x_offset == 0 and y_offset == 0:
        return frame

    if frame.ndim == 3 and frame.shape[2] == 4:
        image = Image.fromarray(frame, "RGBA")
    elif frame.ndim == 3 and frame.shape[2] == 3:
        image = Image.fromarray(frame, "RGB").convert("RGBA")
    else:
        image = Image.fromarray(frame).convert("RGBA")

    shifted = Image.new("RGBA", image.size, (0, 0, 0, 0))
    shifted.paste(image, (x_offset, y_offset), image)
    return np.array(shifted)


async def process_job(
    job_id: str,
    on_progress: Optional[Callable[[JobProgress], Awaitable[None]]] = None,
):
    job = store.get_job(job_id)
    if not job:
        raise ValueError(f"任务不存在: {job_id}")

    video_path = store.get_video_path(job.video_id)
    if not video_path:
        raise ValueError(f"视频不存在: {job.video_id}")

    video_meta = store.get_video_meta(job.video_id)
    if not video_meta:
        raise ValueError(f"视频元数据不存在: {job.video_id}")

    job_dir = store.get_job_dir(job_id)
    frames_dir = job_dir / "frames"
    frames_dir.mkdir(exist_ok=True)

    store.update_job(job_id, status=JobStatus.RUNNING, stage="extract", progress=0.0)

    params = job.params
    requested_timestamps = params.timestamps_ms
    actual_timestamps: list[float] = []
    total = len(requested_timestamps)
    frames = []

    try:
        for i, ts in enumerate(requested_timestamps):
            progress = (i + 0.5) / (total + 1)

            if on_progress:
                await on_progress(JobProgress(
                    stage="extract",
                    progress=progress,
                    message=f"截帧 {i + 1}/{total}",
                ))

            frame, actual_ts = await asyncio.to_thread(
                extract_frame_with_retry,
                video_path,
                ts,
                video_meta.duration_ms,
                video_meta.fps,
            )
            frames.append(frame)
            actual_timestamps.append(actual_ts)

            store.update_job(job_id, progress=progress, stage="extract")

        if params.watermark_box:
            store.update_job(job_id, stage="inpaint", progress=0.5)
            if on_progress:
                await on_progress(JobProgress(
                    stage="inpaint",
                    progress=0.5,
                    message="去除水印...",
                ))

            first_frame = frames[0]
            h, w = first_frame.shape[:2]
            mask = build_mask(w, h, params.watermark_box.model_dump())

            processed_frames = []
            for i, frame in enumerate(frames):
                progress = (i + 0.5) / total
                inpainted = await asyncio.to_thread(inpaint_frame, frame, mask)
                processed_frames.append(inpainted)
                store.update_job(job_id, progress=progress, stage="inpaint")
            frames = processed_frames

        if params.remove_bg:
            store.update_job(job_id, stage="rembg", progress=0.0)
            if on_progress:
                loading_message = "加载去背景模型..."
                if params.remove_bg_mode.value == "white":
                    loading_message = "准备纯白背景去除..."
                await on_progress(JobProgress(
                    stage="rembg",
                    progress=0.0,
                    message=loading_message,
                ))

            if params.remove_bg_mode.value != "white":
                await asyncio.to_thread(preload_model)

            processed_frames = []
            for i, frame in enumerate(frames):
                progress = (i + 0.5) / total
                if on_progress:
                    await on_progress(JobProgress(
                        stage="rembg",
                        progress=progress,
                        message=f"去背景 {i + 1}/{total}",
                    ))
                rgba_frame = await asyncio.to_thread(
                    remove_background,
                    frame,
                    params.remove_bg_mode.value,
                )
                processed_frames.append(rgba_frame)
                store.update_job(job_id, progress=progress, stage="rembg")
            frames = processed_frames

        store.update_job(job_id, stage="pack", progress=0.8)
        if on_progress:
            await on_progress(JobProgress(
                stage="pack",
                progress=0.8,
                message="打包精灵表...",
            ))

        result = _write_job_outputs(
            job_id,
            job_dir,
            frames,
            [int(round(ts)) for ts in actual_timestamps],
            params.layout.cols,
            params.layout.padding,
        )

        store.update_job(
            job_id,
            status=JobStatus.DONE,
            progress=1.0,
            stage="done",
            result=result,
        )

        if on_progress:
            await on_progress(JobProgress(
                stage="done",
                progress=1.0,
                message="处理完成",
                status=JobStatus.DONE,
            ))

    except Exception as e:
        error_msg = str(e)
        store.update_job(
            job_id,
            status=JobStatus.FAILED,
            error=error_msg,
        )

        if on_progress:
            await on_progress(JobProgress(
                stage="error",
                progress=0,
                message=f"处理失败: {error_msg}",
                status=JobStatus.FAILED,
                error=error_msg,
            ))

        raise


async def process_image_job(
    job_id: str,
    on_progress: Optional[Callable[[JobProgress], Awaitable[None]]] = None,
):
    job = store.get_image_job(job_id)
    if not job:
        raise ValueError(f"图片任务不存在: {job_id}")

    image_path = store.get_image_path(job.image_id)
    if not image_path:
        raise ValueError(f"图片不存在: {job.image_id}")

    image_meta = store.get_image_meta(job.image_id)
    if not image_meta:
        raise ValueError(f"图片元数据不存在: {job.image_id}")

    job_dir = store.get_image_job_dir(job_id)
    if not job_dir:
        raise ValueError(f"图片任务目录不存在: {job_id}")

    store.update_image_job(job_id, status=JobStatus.RUNNING, stage="crop", progress=0.0)

    params: CreateImageJobRequest = job.params
    total = len(params.boxes)
    if total == 0:
        raise ValueError("没有可处理的切图区域")

    try:
        with Image.open(image_path) as image:
            source = image.convert("RGBA")

            items: list[np.ndarray] = []
            for index, box in enumerate(params.boxes):
                progress = (index + 0.5) / max(total, 1) * 0.4
                if on_progress:
                    await on_progress(JobProgress(
                        stage="crop",
                        progress=progress,
                        message=f"裁切图片 {index + 1}/{total}",
                    ))

                cropped = source.crop((box.x, box.y, box.x + box.w, box.y + box.h))
                items.append(np.array(cropped))
                store.update_image_job(job_id, progress=progress, stage="crop")

        store.update_image_job(job_id, stage="rembg", progress=0.4)
        await asyncio.to_thread(preload_model)

        processed_items: list[np.ndarray] = []
        for index, item in enumerate(items):
            progress = 0.4 + ((index + 0.5) / max(total, 1) * 0.4)
            if on_progress:
                await on_progress(JobProgress(
                    stage="rembg",
                    progress=progress,
                    message=f"去背景 {index + 1}/{total}",
                ))

            rgb_item = np.array(Image.fromarray(item, "RGBA").convert("RGB"))
            bgr_item = rgb_item[:, :, ::-1]
            rgba_item = await asyncio.to_thread(remove_background, bgr_item)
            processed_items.append(rgba_item)
            store.update_image_job(job_id, progress=progress, stage="rembg")

        store.update_image_job(job_id, stage="pack", progress=0.85)
        result = _write_image_job_outputs(
            job_id,
            job_dir,
            processed_items,
            [box.model_dump() for box in params.boxes],
            (image_meta.width, image_meta.height),
            params.layout.cols,
            params.layout.padding,
        )

        store.update_image_job(
            job_id,
            status=JobStatus.DONE,
            progress=1.0,
            stage="done",
            result=result,
        )

        if on_progress:
            await on_progress(JobProgress(
                stage="done",
                progress=1.0,
                message="处理完成",
                status=JobStatus.DONE,
            ))
    except Exception as exc:
        error_msg = str(exc)
        store.update_image_job(
            job_id,
            status=JobStatus.FAILED,
            error=error_msg,
        )

        if on_progress:
            await on_progress(JobProgress(
                stage="error",
                progress=0.0,
                message=f"处理失败: {error_msg}",
                status=JobStatus.FAILED,
                error=error_msg,
            ))

        raise


async def process_frame_assembly_job(
    job_id: str,
    request: CreateFrameAssemblyJobRequest,
    on_progress: Optional[Callable[[JobProgress], Awaitable[None]]] = None,
):
    job = store.get_job(job_id)
    if not job:
        raise ValueError(f"任务不存在: {job_id}")

    if not request.frames:
        raise ValueError("没有可处理的帧")

    job_dir = store.get_job_dir(job_id)
    if not job_dir:
        raise ValueError(f"任务目录不存在: {job_id}")

    store.update_job(job_id, status=JobStatus.RUNNING, stage="extract", progress=0.0)

    total = len(request.frames)
    frames = []
    actual_timestamps: list[int] = []

    try:
        for i, frame_source in enumerate(request.frames):
            video_path = store.get_video_path(frame_source.video_id)
            video_meta = store.get_video_meta(frame_source.video_id)
            if not video_path or not video_meta:
                raise ValueError(f"视频不存在: {frame_source.video_id}")

            progress = (i + 0.5) / max(total, 1) * 0.45
            if on_progress:
                await on_progress(JobProgress(
                    stage="extract",
                    progress=progress,
                    message=f"截帧 {i + 1}/{total}",
                ))

            frame, actual_ts = await asyncio.to_thread(
                extract_frame_with_retry,
                video_path,
                frame_source.ts_ms,
                video_meta.duration_ms,
                video_meta.fps,
            )
            frames.append(frame)
            actual_timestamps.append(int(round(actual_ts)))
            store.update_job(job_id, progress=progress, stage="extract")

        if request.remove_bg:
            store.update_job(job_id, stage="rembg", progress=0.45)
            if on_progress:
                loading_message = "加载去背景模型..."
                if request.remove_bg_mode.value == "white":
                    loading_message = "准备纯白背景去除..."
                await on_progress(JobProgress(stage="rembg", progress=0.45, message=loading_message))

            if request.remove_bg_mode.value != "white":
                await asyncio.to_thread(preload_model)

            processed_frames = []
            for i, frame in enumerate(frames):
                progress = 0.45 + ((i + 0.5) / max(total, 1) * 0.4)
                if on_progress:
                    await on_progress(JobProgress(
                        stage="rembg",
                        progress=progress,
                        message=f"去背景 {i + 1}/{total}",
                    ))
                rgba_frame = await asyncio.to_thread(
                    remove_background,
                    frame,
                    request.remove_bg_mode.value,
                )
                processed_frames.append(rgba_frame)
                store.update_job(job_id, progress=progress, stage="rembg")
            frames = processed_frames

        if any(frame_source.x_offset != 0 or frame_source.y_offset != 0 for frame_source in request.frames):
            frames = [
                _apply_frame_offset(frame, frame_source.x_offset, frame_source.y_offset)
                for frame, frame_source in zip(frames, request.frames)
            ]

        store.update_job(job_id, stage="pack", progress=0.9)
        if on_progress:
            await on_progress(JobProgress(stage="pack", progress=0.9, message="打包精灵表..."))

        result = _write_job_outputs(
            job_id,
            job_dir,
            frames,
            actual_timestamps,
            request.layout.cols,
            request.layout.padding,
        )
        result["video_ids"] = list(dict.fromkeys(frame.video_id for frame in request.frames))

        store.update_job(
            job_id,
            status=JobStatus.DONE,
            progress=1.0,
            stage="done",
            result=result,
        )

        if on_progress:
            await on_progress(JobProgress(
                stage="done",
                progress=1.0,
                message="处理完成",
                status=JobStatus.DONE,
            ))
    except Exception as e:
        error_msg = str(e)
        store.update_job(job_id, status=JobStatus.FAILED, error=error_msg)

        if on_progress:
            await on_progress(JobProgress(
                stage="error",
                progress=0.0,
                message=f"处理失败: {error_msg}",
                status=JobStatus.FAILED,
                error=error_msg,
            ))

        raise


async def repack_job_frames(
    job_id: str,
    frame_names: list[str],
    frame_offsets: Optional[dict[str, FrameOffset]] = None,
) -> dict:
    job = store.get_job(job_id)
    if not job:
        raise ValueError(f"任务不存在: {job_id}")
    if job.status != JobStatus.DONE:
        raise ValueError("任务尚未完成")
    if not frame_names:
        raise ValueError("至少需要保留一个关键帧")

    job_dir = store.get_job_dir(job_id)
    if not job_dir:
        raise ValueError(f"任务目录不存在: {job_id}")

    frames_dir = job_dir / "frames"
    meta_path = job_dir / "spritesheet.json"
    if not frames_dir.exists() or not meta_path.exists():
        raise ValueError("处理后帧尚未生成")

    with open(meta_path, "r", encoding="utf-8") as f:
        meta = json.load(f)

    timestamps_by_name: dict[str, int] = {}
    for index, frame_meta in enumerate(meta.get("frames", [])):
        timestamps_by_name[f"{index:04d}.png"] = int(frame_meta.get("ts_ms", 0))

    frames: list[np.ndarray] = []
    actual_timestamps: list[int] = []
    for frame_name in frame_names:
        if Path(frame_name).name != frame_name or not frame_name.endswith(".png"):
            raise ValueError("帧文件名无效")

        frame_path = frames_dir / frame_name
        if not frame_path.exists():
            raise ValueError(f"帧不存在: {frame_name}")

        with Image.open(frame_path) as image:
            frame = np.array(image.convert("RGBA"))

        offset = (frame_offsets or {}).get(frame_name)
        if offset and (offset.x != 0 or offset.y != 0):
            frame = _apply_frame_offset(frame, offset.x, offset.y)

        frames.append(frame)
        actual_timestamps.append(timestamps_by_name.get(frame_name, 0))

    version = str(int(time.time() * 1000))
    result = _write_job_outputs(
        job_id,
        job_dir,
        frames,
        actual_timestamps,
        job.params.layout.cols,
        job.params.layout.padding,
        version=version,
    )
    if job.result and job.result.get("video_ids"):
        result["video_ids"] = job.result["video_ids"]

    updated_job = store.update_job(job_id, result=result, progress=1.0, stage="done")
    if not updated_job:
        raise ValueError("任务状态更新失败")

    return result


async def repack_image_job_items(job_id: str, item_names: list[str]) -> dict:
    job = store.get_image_job(job_id)
    if not job:
        raise ValueError(f"图片任务不存在: {job_id}")
    if job.status != JobStatus.DONE:
        raise ValueError("任务尚未完成")
    if not item_names:
        raise ValueError("至少需要保留一个图块")

    job_dir = store.get_image_job_dir(job_id)
    if not job_dir:
        raise ValueError(f"图片任务目录不存在: {job_id}")

    items_dir = job_dir / "items"
    if not items_dir.exists():
        raise ValueError("切图结果不存在")

    items: list[np.ndarray] = []
    normalized_item_names: list[str] = []
    for item_name in item_names:
        if Path(item_name).name != item_name or not item_name.endswith(".png"):
            raise ValueError("图块文件名无效")

        item_path = items_dir / item_name
        if not item_path.exists():
            raise ValueError(f"图块不存在: {item_name}")

        with Image.open(item_path) as image:
            items.append(np.array(image.convert("RGBA")))
        normalized_item_names.append(item_name)

    valid_item_names, boxes = _load_image_job_boxes(job_dir, normalized_item_names)
    if not valid_item_names:
        raise ValueError("没有可保留的有效图块")

    valid_item_name_set = set(valid_item_names)
    filtered_items = [
        item for item_name, item in zip(normalized_item_names, items)
        if item_name in valid_item_name_set
    ]
    image_meta = store.get_image_meta(job.image_id)
    if not image_meta:
        raise ValueError(f"图片元数据不存在: {job.image_id}")

    version = str(int(time.time() * 1000))
    result = _write_image_job_outputs(
        job_id,
        job_dir,
        filtered_items,
        boxes,
        (image_meta.width, image_meta.height),
        job.params.layout.cols,
        job.params.layout.padding,
        version=version,
    )

    updated_job = store.update_image_job(job_id, result=result, progress=1.0, stage="done")
    if not updated_job:
        raise ValueError("任务状态更新失败")

    return result


async def normalize_job_lighting(
    job_id: str,
    on_progress: Optional[Callable[[JobProgress], Awaitable[None]]] = None,
):
    job = store.get_job(job_id)
    if not job:
        raise ValueError(f"任务不存在: {job_id}")
    if job.status not in (JobStatus.DONE, JobStatus.RUNNING):
        raise ValueError("当前任务尚未完成，无法统一灯光")
    if job.status == JobStatus.RUNNING and job.stage != "light":
        raise ValueError("当前任务正在处理中，无法统一灯光")

    job_dir = store.get_job_dir(job_id)
    if not job_dir:
        raise ValueError(f"任务目录不存在: {job_id}")

    frames_dir = job_dir / "frames"
    frames = await asyncio.to_thread(_load_frame_arrays, frames_dir)
    total = len(frames)
    if total == 0:
        raise ValueError("没有可统一灯光的处理后帧")

    current_result = job.result
    frame_timestamps = [int(frame.get("ts_ms", 0)) for frame in (job.result or {}).get("meta_frames", [])]
    if not frame_timestamps:
        meta_path = job_dir / "spritesheet.json"
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
        frame_timestamps = [int(frame.get("ts_ms", 0)) for frame in meta.get("frames", [])]

    try:
        store.update_job(job_id, status=JobStatus.RUNNING, stage="light", progress=0.0, result=current_result)
        if on_progress:
            await on_progress(JobProgress(stage="light", progress=0.0, message="统一灯光..."))

        target_mean, target_std = await asyncio.to_thread(estimate_target_lighting, frames)
        normalized_frames = []
        for i, frame in enumerate(frames):
            progress = (i + 0.5) / total
            if on_progress:
                await on_progress(JobProgress(
                    stage="light",
                    progress=progress,
                    message=f"统一灯光 {i + 1}/{total}",
                ))
            normalized_frame = await asyncio.to_thread(
                normalize_frame_lighting,
                frame,
                target_mean,
                target_std,
            )
            normalized_frames.append(normalized_frame)
            store.update_job(job_id, progress=progress, stage="light", result=current_result)

        version = str(int(asyncio.get_running_loop().time() * 1000))
        result = _write_job_outputs(
            job_id,
            job_dir,
            normalized_frames,
            frame_timestamps,
            job.params.layout.cols,
            job.params.layout.padding,
            version=version,
        )
        if current_result and current_result.get("video_ids"):
            result["video_ids"] = current_result["video_ids"]

        store.update_job(
            job_id,
            status=JobStatus.DONE,
            progress=1.0,
            stage="done",
            result=result,
        )

        if on_progress:
            await on_progress(JobProgress(stage="done", progress=1.0, message="统一灯光完成", status=JobStatus.DONE))
    except Exception:
        store.update_job(
            job_id,
            status=JobStatus.DONE,
            progress=1.0,
            stage="done",
            result=current_result,
        )
        raise
