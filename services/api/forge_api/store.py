import json
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional, List

from .models import VideoMeta, JobStatus, JobStatusResponse, CreateJobRequest


DATA_DIR = Path(__file__).parent.parent.parent.parent / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
JOBS_DIR = DATA_DIR / "jobs"
TMP_DIR = DATA_DIR / "tmp"


def ensure_dirs():
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    TMP_DIR.mkdir(parents=True, exist_ok=True)


def cleanup_tmp_dir():
    import shutil

    if not TMP_DIR.exists():
        return

    for path in TMP_DIR.iterdir():
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        else:
            path.unlink(missing_ok=True)


def generate_id() -> str:
    return str(uuid.uuid4())[:8]


def save_video_meta(
    video_id: str,
    filename: str,
    duration_ms: float,
    fps: float,
    width: int,
    height: int,
) -> VideoMeta:
    video_dir = UPLOADS_DIR / video_id
    video_dir.mkdir(parents=True, exist_ok=True)

    now = datetime.now().isoformat()
    meta = VideoMeta(
        id=video_id,
        filename=filename,
        duration_ms=duration_ms,
        fps=fps,
        width=width,
        height=height,
        created_at=now,
    )

    meta_path = video_dir / "meta.json"
    _write_json(meta_path, meta.model_dump(mode="json"))

    return meta


def get_video_meta(video_id: str) -> Optional[VideoMeta]:
    meta_path = UPLOADS_DIR / video_id / "meta.json"
    if not meta_path.exists():
        return None

    data = _read_json(meta_path)
    return VideoMeta(**data)


def get_video_path(video_id: str) -> Optional[Path]:
    video_dir = UPLOADS_DIR / video_id
    for filename in ("source.mp4", "source.webm"):
        video_path = video_dir / filename
        if video_path.exists():
            return video_path
    return None


def create_job(
    video_id: str,
    params: CreateJobRequest,
) -> JobStatusResponse:
    job_id = f"j_{generate_id()}"
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    (job_dir / "frames").mkdir(exist_ok=True)

    now = datetime.now().isoformat()
    job = JobStatusResponse(
        id=job_id,
        video_id=video_id,
        status=JobStatus.PENDING,
        progress=0.0,
        stage="",
        params=params,
        error=None,
        created_at=now,
        finished_at=None,
        result=None,
    )

    job_path = job_dir / "job.json"
    _write_json(job_path, job.model_dump(mode="json"))

    return job


def get_job(job_id: str) -> Optional[JobStatusResponse]:
    job_path = JOBS_DIR / job_id / "job.json"
    if not job_path.exists():
        return None

    data = _read_json(job_path)
    return JobStatusResponse(**data)


def update_job(
    job_id: str,
    status: Optional[JobStatus] = None,
    progress: Optional[float] = None,
    stage: Optional[str] = None,
    error: Optional[str] = None,
    result: Optional[dict] = None,
) -> Optional[JobStatusResponse]:
    job = get_job(job_id)
    if not job:
        return None

    if status is not None:
        job.status = status
    if progress is not None:
        job.progress = progress
    if stage is not None:
        job.stage = stage
    if error is not None:
        job.error = error
    if result is not None:
        job.result = result

    if status in (JobStatus.DONE, JobStatus.FAILED):
        job.finished_at = datetime.now().isoformat()

    job_path = JOBS_DIR / job_id / "job.json"
    tmp_path = job_path.with_suffix(".json.tmp")
    _write_json(tmp_path, job.model_dump(mode="json"))
    tmp_path.rename(job_path)

    return job


def get_job_dir(job_id: str) -> Optional[Path]:
    job_dir = JOBS_DIR / job_id
    if not job_dir.exists():
        return None
    return job_dir


def list_jobs() -> List[JobStatusResponse]:
    jobs = []
    if JOBS_DIR.exists():
        for job_dir in JOBS_DIR.iterdir():
            if job_dir.is_dir():
                job = get_job(job_dir.name)
                if job:
                    jobs.append(job)
    return sorted(jobs, key=lambda j: j.created_at, reverse=True)


def delete_job(job_id: str) -> bool:
    import shutil

    job_dir = JOBS_DIR / job_id
    if not job_dir.exists():
        return False

    shutil.rmtree(job_dir)
    return True


def delete_video(video_id: str) -> bool:
    import shutil

    video_dir = UPLOADS_DIR / video_id
    if not video_dir.exists():
        return False

    shutil.rmtree(video_dir)

    for job in list_jobs():
        if job.video_id == video_id:
            job_dir = JOBS_DIR / job.id
            if job_dir.exists():
                shutil.rmtree(job_dir)

    return True


def _write_json(path: Path, data: dict):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _read_json(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


ensure_dirs()
