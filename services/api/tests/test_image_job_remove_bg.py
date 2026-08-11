"""Tests for image job remove_bg_mode handling (S5) and lighting alpha-weighting (S4 algorithm)."""
import asyncio
from unittest.mock import patch, MagicMock

import numpy as np
import pytest
from PIL import Image

from forge_api import store, worker
from forge_api.models import (
    CreateImageJobRequest,
    ImageEntry,
    SegmentBox,
    RemoveBgMode,
)


def _make_image(image_id: str = "imgtest1") -> str:
    """Create a fake image meta + dummy source file."""
    store.save_image_meta(image_id, "test.png", 100, 100)
    image_dir = store.IMAGES_DIR / image_id
    img = Image.new("RGBA", (100, 100), (255, 0, 0, 255))
    img.save(str(image_dir / "source.png"))
    return image_id


class TestImageJobRemoveBgMode:
    """S5: process_image_job must respect params.remove_bg and remove_bg_mode."""

    def test_remove_bg_true_calls_remove_background_with_mode(self, isolated_data_dir):
        image_id = _make_image("imgs5bg01")
        params = CreateImageJobRequest(
            images=[ImageEntry(image_id=image_id, boxes=[SegmentBox(x=0, y=0, w=50, h=50)])],
            remove_bg=True,
            remove_bg_mode=RemoveBgMode.WHITE,
        )
        job = store.create_image_job([image_id], params)

        captured_modes = []
        original_remove = worker.remove_background

        def tracking_remove(frame, mode="standard"):
            captured_modes.append(mode)
            return original_remove(frame, mode)

        with patch("forge_api.worker.remove_background", side_effect=tracking_remove):
            asyncio.run(worker.process_image_job(job.id))

        assert len(captured_modes) == 1
        assert captured_modes[0] == "white"

        final = store.get_image_job(job.id)
        assert final.status.value == "done"

    def test_remove_bg_false_skips_background_removal(self, isolated_data_dir):
        image_id = _make_image("imgs5off2")
        params = CreateImageJobRequest(
            images=[ImageEntry(image_id=image_id, boxes=[SegmentBox(x=0, y=0, w=50, h=50)])],
            remove_bg=False,
        )
        job = store.create_image_job([image_id], params)

        with patch("forge_api.worker.remove_background") as mock_remove:
            asyncio.run(worker.process_image_job(job.id))

        mock_remove.assert_not_called()
        final = store.get_image_job(job.id)
        assert final.status.value == "done"

    def test_remove_bg_default_is_solid(self, isolated_data_dir):
        """CreateImageJobRequest defaults to SOLID mode (backward compat)."""
        image_id = _make_image("imgs5def03")
        params = CreateImageJobRequest(
            images=[ImageEntry(image_id=image_id, boxes=[SegmentBox(x=0, y=0, w=50, h=50)])],
        )
        assert params.remove_bg_mode == RemoveBgMode.SOLID
