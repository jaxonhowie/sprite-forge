"""Tests for Lottie (bodymovin JSON) export builders."""
import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from forge_api import store
from forge_api.exporters import (
    ANIMATION_FPS,
    _build_lottie_from_pngs,
    build_image_lottie,
    build_video_lottie,
)
from forge_api.main import app
from forge_api.models import (
    CreateImageJobRequest,
    CreateJobRequest,
    ImageEntry,
    SegmentBox,
)


def _make_png(path, w, h, color=(255, 0, 0, 255)):
    Image.new("RGBA", (w, h), color).save(str(path))


class TestBuildLottieFromPngs:
    def test_empty_raises(self, tmp_path):
        with pytest.raises(ValueError, match="没有可导出的 PNG 帧"):
            _build_lottie_from_pngs([], tmp_path / "out.json")

    def test_structure_single_frame(self, tmp_path):
        png = tmp_path / "frame.png"
        _make_png(png, 32, 16)
        out = tmp_path / "out.json"
        data = _build_lottie_from_pngs([png], out)

        assert data["v"] == "5.7.4"
        assert data["fr"] == ANIMATION_FPS
        assert data["ip"] == 0
        assert data["op"] == 1
        assert data["w"] == 32 and data["h"] == 16
        assert data["ddd"] == 0

        assert len(data["assets"]) == 1
        asset = data["assets"][0]
        assert asset["id"] == "fr_0"
        assert asset["w"] == 32 and asset["h"] == 16
        assert asset["e"] == 1
        assert asset["u"] == ""
        assert asset["p"].startswith("data:image/png;base64,")

        assert len(data["layers"]) == 1
        layer = data["layers"][0]
        assert layer["ty"] == 2
        assert layer["refId"] == "fr_0"
        assert layer["ip"] == 0 and layer["op"] == 1
        assert layer["ks"]["p"]["k"] == [16.0, 8.0, 0]  # centered in 32x16

        # written to disk as valid JSON, identical to returned dict
        loaded = json.loads(out.read_text(encoding="utf-8"))
        assert loaded == data

    def test_multiframe_uses_max_dims_and_one_visible_per_frame(self, tmp_path):
        a = tmp_path / "0.png"
        b = tmp_path / "1.png"
        _make_png(a, 10, 20)
        _make_png(b, 30, 5)
        data = _build_lottie_from_pngs([a, b], tmp_path / "out.json")

        assert data["w"] == 30 and data["h"] == 20  # max per dimension
        assert data["op"] == 2
        assert len(data["assets"]) == 2
        assert len(data["layers"]) == 2

        # layer 0 visible at t=0 only
        k0 = data["layers"][0]["ks"]["o"]["k"]
        assert k0[0]["t"] == 0 and k0[0]["s"] == [100] and k0[0].get("h") == 1
        assert k0[1]["t"] == 1 and k0[1]["s"] == [0]

        # layer 1 starts hidden, shows at t=1, hides at t=2
        k1 = data["layers"][1]["ks"]["o"]["k"]
        assert k1[0]["t"] == 0 and k1[0]["s"] == [0]
        assert k1[1]["t"] == 1 and k1[1]["s"] == [100]
        assert k1[2]["t"] == 2 and k1[2]["s"] == [0]

    def test_custom_fps(self, tmp_path):
        png = tmp_path / "frame.png"
        _make_png(png, 8, 8)
        data = _build_lottie_from_pngs([png], tmp_path / "out.json", fps=24)
        assert data["fr"] == 24


class TestBuildVideoLottie:
    def test_reads_frames_dir_and_animation_fps(self, tmp_path):
        job_dir = tmp_path / "job"
        (job_dir / "frames").mkdir(parents=True)
        _make_png(job_dir / "frames" / "0.png", 12, 12)
        _make_png(job_dir / "frames" / "1.png", 12, 12)
        (job_dir / "spritesheet.json").write_text(
            json.dumps({"animation": {"fps": 10, "loop": True}, "frames": []}),
            encoding="utf-8",
        )

        out = tmp_path / "out.json"
        build_video_lottie(job_dir, out)
        data = json.loads(out.read_text(encoding="utf-8"))
        assert data["fr"] == 10
        assert data["op"] == 2

    def test_missing_frames_raises(self, tmp_path):
        job_dir = tmp_path / "job"
        job_dir.mkdir()
        with pytest.raises(ValueError, match="没有可导出的 PNG 帧"):
            build_video_lottie(job_dir, tmp_path / "out.json")

    def test_corrupt_meta_falls_back_to_default_fps(self, tmp_path):
        job_dir = tmp_path / "job"
        (job_dir / "frames").mkdir(parents=True)
        _make_png(job_dir / "frames" / "0.png", 8, 8)
        (job_dir / "spritesheet.json").write_text("{not valid json", encoding="utf-8")

        out = tmp_path / "out.json"
        build_video_lottie(job_dir, out)
        assert json.loads(out.read_text(encoding="utf-8"))["fr"] == ANIMATION_FPS


class TestBuildImageLottie:
    def test_reads_items_dir_default_fps(self, tmp_path):
        job_dir = tmp_path / "ijob"
        (job_dir / "items").mkdir(parents=True)
        _make_png(job_dir / "items" / "0.png", 20, 20)

        out = tmp_path / "out.json"
        build_image_lottie(job_dir, out)
        data = json.loads(out.read_text(encoding="utf-8"))
        assert data["fr"] == ANIMATION_FPS  # no animation meta -> default
        assert data["op"] == 1


class TestExportLottieEndpoint:
    def test_video_lottie_export(self):
        job = store.create_job("v_test", CreateJobRequest(video_id="v_test", timestamps_ms=[0.0]))
        job_dir = store.get_job_dir(job.id)
        Image.new("RGBA", (16, 16), (255, 0, 0, 255)).save(str(job_dir / "frames" / "0.png"))
        Image.new("RGBA", (16, 16), (0, 255, 0, 255)).save(str(job_dir / "frames" / "1.png"))

        with TestClient(app) as client:
            resp = client.get(f"/api/jobs/{job.id}/export.zip", params={"target": "lottie"})

        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/json"
        assert resp.headers["content-disposition"].endswith(f'spritesheet_{job.id}.json"')
        data = resp.json()
        assert data["op"] == 2
        assert len(data["assets"]) == 2
        assert len(data["layers"]) == 2

    def test_video_lottie_no_frames_returns_400(self):
        job = store.create_job("v_test", CreateJobRequest(video_id="v_test", timestamps_ms=[0.0]))
        with TestClient(app) as client:
            resp = client.get(f"/api/jobs/{job.id}/export.zip", params={"target": "lottie"})
        assert resp.status_code == 400
        assert "没有可导出的" in resp.json()["detail"]

    def test_image_lottie_export(self):
        entry = ImageEntry(image_id="img_test", boxes=[SegmentBox(x=0, y=0, w=8, h=8)])
        job = store.create_image_job(["img_test"], CreateImageJobRequest(images=[entry]))
        job_dir = store.get_image_job_dir(job.id)
        Image.new("RGBA", (20, 20), (0, 0, 255, 255)).save(str(job_dir / "items" / "0.png"))

        with TestClient(app) as client:
            resp = client.get(f"/api/image-jobs/{job.id}/export.zip", params={"target": "lottie"})

        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/json"
        assert resp.headers["content-disposition"].endswith(f'image_segments_{job.id}.json"')
        data = resp.json()
        assert data["op"] == 1
        assert len(data["assets"]) == 1
