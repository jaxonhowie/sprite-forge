import asyncio
import json
import shutil
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, UploadFile, File, HTTPException, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from .models import (
    CreateJobRequest,
    VideoUploadResponse,
    JobResponse,
    JobStatusResponse,
    JobProgress,
    JobStatus,
)
from . import store
from .media.extract import get_video_info
from .worker import process_job


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

    source_path = video_dir / "source.mp4"
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
        url=f"/files/uploads/{meta.id}/source.mp4",
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
        url=f"/files/uploads/{meta.id}/source.mp4",
    )


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


async def run_job_background(job_id: str):
    try:
        await process_job(job_id)
    except Exception as e:
        print(f"任务 {job_id} 执行失败: {e}")


@app.get("/api/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job(job_id: str):
    job = store.get_job(job_id)
    if not job:
        raise HTTPException(404, "任务不存在")
    return job


@app.delete("/api/jobs/{job_id}")
async def delete_job(job_id: str):
    success = store.delete_job(job_id)
    if not success:
        raise HTTPException(404, "任务不存在")
    return {"message": "删除成功"}


@app.get("/api/jobs/{job_id}/export.zip")
async def export_job(job_id: str):
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

    with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
        zip_path = Path(tmp.name)

    shutil.make_archive(str(zip_path.with_suffix("")), "zip", job_dir)

    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=f"spritesheet_{job_id}.zip",
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
