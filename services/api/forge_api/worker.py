import asyncio
import json
from pathlib import Path
from typing import Optional, Callable, Awaitable
from PIL import Image

from .models import JobStatus, JobProgress, CreateJobRequest
from . import store
from .media.extract import extract_frame
from .media.inpaint import build_mask, inpaint_frame
from .media.remove_bg import remove_background, preload_model
from .media.pack import pack_grid


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

    job_dir = store.get_job_dir(job_id)
    frames_dir = job_dir / "frames"
    frames_dir.mkdir(exist_ok=True)

    store.update_job(job_id, status=JobStatus.RUNNING, stage="extract", progress=0.0)

    params = job.params
    timestamps = params.timestamps_ms
    total = len(timestamps)
    frames = []

    try:
        for i, ts in enumerate(timestamps):
            progress = (i + 0.5) / (total + 1)

            if on_progress:
                await on_progress(JobProgress(
                    stage="extract",
                    progress=progress,
                    message=f"截帧 {i + 1}/{total}",
                ))

            frame = await asyncio.to_thread(extract_frame, video_path, ts)
            frames.append(frame)

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
                await on_progress(JobProgress(
                    stage="rembg",
                    progress=0.0,
                    message="加载去背景模型...",
                ))

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
                rgba_frame = await asyncio.to_thread(remove_background, frame)
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

        sheet, meta = pack_grid(
            frames,
            cols=params.layout.cols,
            padding=params.layout.padding,
        )

        sheet_path = job_dir / "spritesheet.png"
        sheet.save(str(sheet_path))

        frame_urls = []
        for i, frame in enumerate(frames):
            frame_path = frames_dir / f"{i:04d}.png"
            if frame.ndim == 3 and frame.shape[2] == 4:
                Image.fromarray(frame, "RGBA").save(str(frame_path))
            elif frame.ndim == 3 and frame.shape[2] == 3:
                Image.fromarray(frame, "RGB").save(str(frame_path))
            else:
                Image.fromarray(frame).save(str(frame_path))
            frame_urls.append(f"/files/jobs/{job_id}/frames/{i:04d}.png")

        meta_path = job_dir / "spritesheet.json"
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)

        result = {
            "spritesheet_url": f"/files/jobs/{job_id}/spritesheet.png",
            "json_url": f"/files/jobs/{job_id}/spritesheet.json",
            "frame_urls": frame_urls,
        }

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
