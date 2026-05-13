import asyncio
import shutil
from typing import Literal
from PIL import Image

from fastapi import FastAPI, UploadFile, File, HTTPException, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from .models import (
    CreateJobRequest,
    CreateImageJobRequest,
    ExtractFramesRequest,
    ExtractFramesResponse,
    ExtractedFramePreview,
    VideoUploadResponse,
    ImageUploadResponse,
    DetectSegmentsResponse,
    DetectedSegment,
    JobResponse,
    JobStatusResponse,
    ImageJobStatusResponse,
    JobProgress,
    JobStatus,
)
from . import store
from .exporters import build_engine_export, build_image_export
from .media.extract import extract_frame_with_retry, get_video_info, save_frame_preview
from .media.segment import detect_segments
from .worker import normalize_job_lighting, process_job, process_image_job


app = FastAPI(title="Sprite Forge API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_FILE_SIZE = 500 * 1024 * 1024

active_jobs: dict[str, asyncio.Task] = {}


def get_source_suffix(content_type: str) -> str:
    if content_type == "video/webm":
        return ".webm"
    return ".mp4"


def get_image_suffix(content_type: str) -> str:
    if content_type == "image/webp":
        return ".webp"
    if content_type == "image/jpeg":
        return ".jpg"
    return ".png"


@app.post("/api/videos", response_model=VideoUploadResponse)
async def upload_video(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("video/"):
        raise HTTPException(400, "只支持视频文件")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(413, "文件大小不能超过 500MB")

    video_id = store.generate_id()
    video_dir = store.UPLOADS_DIR / video_id
    video_dir.mkdir(parents=True, exist_ok=True)

    source_path = video_dir / f"source{get_source_suffix(file.content_type)}"
    with open(source_path, "wb") as f:
        f.write(content)

    try:
        info = get_video_info(source_path)
    except Exception as e:
        shutil.rmtree(video_dir)
        raise HTTPException(400, f"无法解析视频: {str(e)}")

    meta = store.save_video_meta(
        video_id=video_id,
        filename=file.filename or "video.mp4",
        duration_ms=info["duration_ms"],
        fps=info["fps"],
        width=info["width"],
        height=info["height"],
    )

    return VideoUploadResponse(
        video_id=meta.id,
        duration_ms=meta.duration_ms,
        fps=meta.fps,
        width=meta.width,
        height=meta.height,
        url=f"/api/videos/{meta.id}/source",
    )


@app.post("/api/images", response_model=ImageUploadResponse)
async def upload_image(file: UploadFile = File(...)):
    if file.content_type not in {"image/png", "image/jpeg", "image/webp"}:
        raise HTTPException(400, "只支持 PNG、JPG、WebP 图片")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(413, "文件大小不能超过 500MB")

    image_id = store.generate_id()
    image_dir = store.IMAGES_DIR / image_id
    image_dir.mkdir(parents=True, exist_ok=True)

    source_path = image_dir / f"source{get_image_suffix(file.content_type)}"
    with open(source_path, "wb") as f:
        f.write(content)

    try:
        with Image.open(source_path) as image:
            width, height = image.size
    except Exception as exc:
        shutil.rmtree(image_dir, ignore_errors=True)
        raise HTTPException(400, f"无法解析图片: {str(exc)}") from exc

    meta = store.save_image_meta(
        image_id=image_id,
        filename=file.filename or source_path.name,
        width=width,
        height=height,
    )

    return ImageUploadResponse(
        image_id=meta.id,
        width=meta.width,
        height=meta.height,
        url=f"/api/images/{meta.id}/source",
    )


@app.get("/api/videos/{video_id}", response_model=VideoUploadResponse)
async def get_video(video_id: str):
    meta = store.get_video_meta(video_id)
    if not meta:
        raise HTTPException(404, "视频不存在")

    return VideoUploadResponse(
        video_id=meta.id,
        duration_ms=meta.duration_ms,
        fps=meta.fps,
        width=meta.width,
        height=meta.height,
        url=f"/api/videos/{meta.id}/source",
    )


@app.get("/api/images/{image_id}", response_model=ImageUploadResponse)
async def get_image(image_id: str):
    meta = store.get_image_meta(image_id)
    if not meta:
        raise HTTPException(404, "图片不存在")

    return ImageUploadResponse(
        image_id=meta.id,
        width=meta.width,
        height=meta.height,
        url=f"/api/images/{meta.id}/source",
    )


@app.get("/api/videos/{video_id}/source")
async def get_video_source(video_id: str):
    video_path = store.get_video_path(video_id)
    if not video_path:
        raise HTTPException(404, "视频不存在")

    return FileResponse(video_path)


@app.get("/api/images/{image_id}/source")
async def get_image_source(image_id: str):
    image_path = store.get_image_path(image_id)
    if not image_path:
        raise HTTPException(404, "图片不存在")

    return FileResponse(image_path)


@app.post("/api/videos/{video_id}/frames", response_model=ExtractFramesResponse)
async def extract_video_frames(video_id: str, request: ExtractFramesRequest):
    video_meta = store.get_video_meta(video_id)
    if not video_meta:
        raise HTTPException(404, "视频不存在")

    video_path = store.get_video_path(video_id)
    if not video_path:
        raise HTTPException(404, "视频文件不存在")

    timestamps = request.timestamps_ms
    if not timestamps:
        return ExtractFramesResponse(frames=[])

    thumbs_dir = store.UPLOADS_DIR / video_id / "thumbs"
    thumbs_dir.mkdir(parents=True, exist_ok=True)
    for existing_path in thumbs_dir.glob("*.png"):
        existing_path.unlink(missing_ok=True)

    frames: list[ExtractedFramePreview] = []

    try:
        for index, timestamp_ms in enumerate(timestamps):
            frame, actual_ts = await asyncio.to_thread(
                extract_frame_with_retry,
                video_path,
                timestamp_ms,
                video_meta.duration_ms,
                video_meta.fps,
            )
            rounded_ts = int(round(actual_ts))
            filename = f"{index:04d}_{rounded_ts}.png"
            output_path = thumbs_dir / filename

            await asyncio.to_thread(save_frame_preview, frame, output_path)

            frames.append(
                ExtractedFramePreview(
                    ts_ms=rounded_ts,
                    url=f"/files/uploads/{video_id}/thumbs/{filename}",
                )
            )
    except Exception as exc:
        raise HTTPException(500, f"自动截帧失败: {str(exc)}") from exc

    return ExtractFramesResponse(frames=frames)


@app.post("/api/images/{image_id}/segments:detect", response_model=DetectSegmentsResponse)
async def detect_image_segments(image_id: str):
    image_meta = store.get_image_meta(image_id)
    if not image_meta:
        raise HTTPException(404, "图片不存在")

    image_path = store.get_image_path(image_id)
    if not image_path:
        raise HTTPException(404, "图片文件不存在")

    try:
        segments = await asyncio.to_thread(detect_segments, image_path)
    except Exception as exc:
        raise HTTPException(500, f"切图检测失败: {str(exc)}") from exc

    if not segments:
        raise HTTPException(400, "未检测到有效图块，请确认图片为白底且元素彼此分离")

    return DetectSegmentsResponse(
        segments=[
            DetectedSegment(index=index, box=segment)
            for index, segment in enumerate(segments)
        ]
    )


@app.delete("/api/videos/{video_id}")
async def delete_video(video_id: str):
    success = store.delete_video(video_id)
    if not success:
        raise HTTPException(404, "视频不存在")
    return {"message": "删除成功"}


@app.delete("/api/images/{image_id}")
async def delete_image(image_id: str):
    success = store.delete_image(image_id)
    if not success:
        raise HTTPException(404, "图片不存在")
    return {"message": "删除成功"}


@app.post("/api/jobs", response_model=JobResponse)
async def create_job(
    request: CreateJobRequest,
    background_tasks: BackgroundTasks,
):
    video_meta = store.get_video_meta(request.video_id)
    if not video_meta:
        raise HTTPException(404, "视频不存在")

    job = store.create_job(request.video_id, request)

    background_tasks.add_task(run_job_background, job.id)

    return JobResponse(job_id=job.id, status=job.status)


@app.post("/api/image-jobs", response_model=JobResponse)
async def create_image_job(
    request: CreateImageJobRequest,
    background_tasks: BackgroundTasks,
):
    image_meta = store.get_image_meta(request.image_id)
    if not image_meta:
        raise HTTPException(404, "图片不存在")
    if not request.boxes:
        raise HTTPException(400, "至少需要一个切图区域")

    job = store.create_image_job(request.image_id, request)
    background_tasks.add_task(run_image_job_background, job.id)

    return JobResponse(job_id=job.id, status=job.status)


async def run_job_background(job_id: str):
    try:
        await process_job(job_id)
    except Exception as e:
        print(f"任务 {job_id} 执行失败: {e}")


async def run_image_job_background(job_id: str):
    try:
        await process_image_job(job_id)
    except Exception as e:
        print(f"图片任务 {job_id} 执行失败: {e}")


async def run_light_normalization_background(job_id: str):
    try:
        await normalize_job_lighting(job_id)
    except Exception as e:
        print(f"任务 {job_id} 统一灯光失败: {e}")


@app.get("/api/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job(job_id: str):
    job = store.get_job(job_id)
    if not job:
        raise HTTPException(404, "任务不存在")
    return job


@app.get("/api/image-jobs/{job_id}", response_model=ImageJobStatusResponse)
async def get_image_job(job_id: str):
    job = store.get_image_job(job_id)
    if not job:
        raise HTTPException(404, "图片任务不存在")
    return job


@app.post("/api/jobs/{job_id}/normalize-lighting", response_model=JobStatusResponse)
async def normalize_job(job_id: str, background_tasks: BackgroundTasks):
    job = store.get_job(job_id)
    if not job:
        raise HTTPException(404, "任务不存在")
    if job.status == JobStatus.RUNNING:
        raise HTTPException(409, "任务正在处理中")
    if job.status != JobStatus.DONE:
        raise HTTPException(400, "任务尚未完成")
    if not job.result or not job.result.get("frame_urls"):
        raise HTTPException(400, "没有可统一灯光的处理后帧")

    store.update_job(job_id, status=JobStatus.RUNNING, stage="light", progress=0.0, result=job.result)
    background_tasks.add_task(run_light_normalization_background, job_id)
    updated_job = store.get_job(job_id)
    if not updated_job:
        raise HTTPException(500, "任务状态更新失败")
    return updated_job


@app.delete("/api/jobs/{job_id}")
async def delete_job(job_id: str):
    success = store.delete_job(job_id)
    if not success:
        raise HTTPException(404, "任务不存在")
    return {"message": "删除成功"}


@app.get("/api/jobs/{job_id}/export.zip")
async def export_job(
    job_id: str,
    background_tasks: BackgroundTasks,
    target: Literal["generic", "cocos", "unity", "godot"] = "generic",
):
    job = store.get_job(job_id)
    if not job:
        raise HTTPException(404, "任务不存在")

    job_dir = store.get_job_dir(job_id)
    if not job_dir:
        raise HTTPException(404, "任务目录不存在")

    sheet_path = job_dir / "spritesheet.png"
    meta_path = job_dir / "spritesheet.json"

    if not sheet_path.exists() or not meta_path.exists():
        raise HTTPException(400, "精灵表尚未生成")

    zip_path = store.TMP_DIR / f"{job_id}_{target}_export.zip"
    build_engine_export(job_id, job_dir, zip_path, target)

    background_tasks.add_task(zip_path.unlink, missing_ok=True)

    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=f"spritesheet_{job_id}_{target}.zip",
    )


@app.get("/api/image-jobs/{job_id}/export.zip")
async def export_image_job(job_id: str, background_tasks: BackgroundTasks):
    job = store.get_image_job(job_id)
    if not job:
        raise HTTPException(404, "图片任务不存在")

    job_dir = store.get_image_job_dir(job_id)
    if not job_dir:
        raise HTTPException(404, "图片任务目录不存在")

    sheet_path = job_dir / "spritesheet.png"
    meta_path = job_dir / "spritesheet.json"
    if not sheet_path.exists() or not meta_path.exists():
        raise HTTPException(400, "切图结果尚未生成")

    zip_path = store.TMP_DIR / f"{job_id}_image_export.zip"
    build_image_export(job_id, job_dir, zip_path)
    background_tasks.add_task(zip_path.unlink, missing_ok=True)

    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=f"image_segments_{job_id}.zip",
    )


@app.websocket("/ws/jobs/{job_id}")
async def job_websocket(websocket: WebSocket, job_id: str):
    await websocket.accept()

    job = store.get_job(job_id)
    if not job:
        await websocket.close(code=4004, reason="任务不存在")
        return

    try:
        if job.status in (JobStatus.DONE, JobStatus.FAILED):
            await websocket.send_json({
                "stage": job.stage,
                "progress": job.progress,
                "status": job.status.value,
                "error": job.error,
            })
            await websocket.close()
            return

        while True:
            job = store.get_job(job_id)
            if not job:
                break

            await websocket.send_json({
                "stage": job.stage,
                "progress": job.progress,
                "status": job.status.value,
                "error": job.error,
            })

            if job.status in (JobStatus.DONE, JobStatus.FAILED):
                break

            await asyncio.sleep(0.5)

        await websocket.close()

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"WebSocket 错误: {e}")
        try:
            await websocket.close()
        except:
            pass


app.mount("/files", StaticFiles(directory=str(store.DATA_DIR)), name="files")


@app.on_event("startup")
async def startup():
    store.ensure_dirs()
    store.cleanup_tmp_dir()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
