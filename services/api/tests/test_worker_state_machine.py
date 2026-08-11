"""Tests for worker task lifecycle: validation failures must mark FAILED (S3),
lighting normalization failures must mark FAILED (S4)."""
import asyncio
import json
from unittest.mock import patch, MagicMock

import numpy as np
import pytest

from forge_api import store, worker
from forge_api.models import (
    CreateJobRequest,
    CreateImageJobRequest,
    CreateFrameAssemblyJobRequest,
    JobStatus,
    Layout,
    ImageEntry,
    SegmentBox,
    RemoveBgMode,
)


def _make_video(video_id: str = "vtest1234") -> str:
    """Create a fake video meta + dummy source file so store lookups succeed."""
    store.save_video_meta(video_id, "test.mp4", 10000.0, 30.0, 1920, 1080)
    video_dir = store.UPLOADS_DIR / video_id
    (video_dir / "source.mp4").write_bytes(b"fake")
    return video_id


class TestProcessJobValidationFailure:
    """S3: process_job validation failures must mark the job FAILED, not leave it PENDING."""

    def test_missing_video_marks_failed(self, isolated_data_dir):
        params = CreateJobRequest(video_id="nonexist", timestamps_ms=[1000.0])
        job = store.create_job("nonexist", params)
        job_id = job.id

        # Worker re-raises after marking FAILED — that's the contract for the background runner.
        with pytest.raises(ValueError):
            asyncio.run(worker.process_job(job_id))

        final = store.get_job(job_id)
        assert final.status == JobStatus.FAILED
        assert final.error is not None
        assert "视频不存在" in final.error or "不存在" in final.error

    def test_missing_meta_marks_failed(self, isolated_data_dir):
        video_id = _make_video("vmeta0001")
        (store.UPLOADS_DIR / video_id / "meta.json").unlink()

        params = CreateJobRequest(video_id=video_id, timestamps_ms=[1000.0])
        job = store.create_job(video_id, params)

        with pytest.raises(ValueError):
            asyncio.run(worker.process_job(job.id))

        final = store.get_job(job.id)
        assert final.status == JobStatus.FAILED
        assert "元数据不存在" in (final.error or "")


class TestProcessImageJobValidationFailure:
    """S3: process_image_job validation failures must mark FAILED."""

    def test_missing_job_marks_failed(self, isolated_data_dir):
        params = CreateImageJobRequest(
            images=[ImageEntry(image_id="nonexist", boxes=[SegmentBox(x=0, y=0, w=10, h=10)])]
        )
        job = store.create_image_job(["nonexist"], params)

        with pytest.raises(ValueError):
            asyncio.run(worker.process_image_job(job.id))

        final = store.get_image_job(job.id)
        assert final.status == JobStatus.FAILED


class TestNormalizeLightingFailure:
    """S4: normalize_job_lighting failures must mark FAILED (not DONE)."""

    def test_lighting_failure_marks_failed(self, isolated_data_dir):
        video_id = _make_video("vlight001")
        params = CreateJobRequest(video_id=video_id, timestamps_ms=[1000.0], remove_bg=False)
        job = store.create_job(video_id, params)

        # Job is PENDING (not DONE), so normalize raises + marks FAILED + re-raises.
        with pytest.raises(ValueError):
            asyncio.run(worker.normalize_job_lighting(job.id))

        final = store.get_job(job.id)
        assert final.status == JobStatus.FAILED
        assert final.error is not None
        assert "灯光" in final.error or "尚未完成" in final.error

    def test_lighting_internal_failure_marks_failed(self, isolated_data_dir):
        """If the lighting algorithm itself throws, status must be FAILED."""
        video_id = _make_video("vlight002")
        params = CreateJobRequest(video_id=video_id, timestamps_ms=[1000.0], remove_bg=False)
        job = store.create_job(video_id, params)

        job_dir = store.JOBS_DIR / job.id
        frames_dir = job_dir / "frames"
        frames_dir.mkdir(exist_ok=True)
        dummy_frame = np.zeros((4, 4, 4), dtype=np.uint8)
        dummy_frame[:, :, 3] = 255
        from PIL import Image
        Image.fromarray(dummy_frame, "RGBA").save(str(frames_dir / "0000.png"))

        meta_path = job_dir / "spritesheet.json"
        meta_path.write_text(json.dumps({"frames": [{"ts_ms": 1000}]}))

        store.update_job(job.id, status=JobStatus.DONE, progress=1.0, stage="done",
                         result={"frame_urls": ["/dummy"]})

        with patch("forge_api.worker.estimate_target_lighting", side_effect=RuntimeError("GPU OOM")):
            with pytest.raises(RuntimeError):
                asyncio.run(worker.normalize_job_lighting(job.id))

        final = store.get_job(job.id)
        assert final.status == JobStatus.FAILED
        assert "灯光统一失败" in (final.error or "")
        assert "GPU OOM" in (final.error or "")
