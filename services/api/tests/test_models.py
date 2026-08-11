"""Tests for models.py: CreateImageJobRequest must include remove_bg_mode (S5)."""
import pytest

from forge_api.models import (
    CreateImageJobRequest,
    CreateJobRequest,
    CreateFrameAssemblyJobRequest,
    ImageEntry,
    SegmentBox,
    RemoveBgMode,
)


class TestCreateImageJobRequest:
    """S5: CreateImageJobRequest must have a remove_bg_mode field defaulting to SOLID."""

    def test_has_remove_bg_mode_field(self):
        params = CreateImageJobRequest(
            images=[ImageEntry(image_id="test1234", boxes=[SegmentBox(x=0, y=0, w=10, h=10)])],
        )
        assert hasattr(params, "remove_bg_mode")
        assert params.remove_bg_mode == RemoveBgMode.SOLID

    def test_accepts_explicit_white_mode(self):
        params = CreateImageJobRequest(
            images=[ImageEntry(image_id="test1234", boxes=[SegmentBox(x=0, y=0, w=10, h=10)])],
            remove_bg_mode=RemoveBgMode.WHITE,
        )
        assert params.remove_bg_mode == RemoveBgMode.WHITE

    def test_accepts_standard_mode(self):
        params = CreateImageJobRequest(
            images=[ImageEntry(image_id="test1234", boxes=[SegmentBox(x=0, y=0, w=10, h=10)])],
            remove_bg_mode=RemoveBgMode.STANDARD,
        )
        assert params.remove_bg_mode == RemoveBgMode.STANDARD

    def test_serializes_remove_bg_mode(self):
        """Round-trip through model_dump should preserve remove_bg_mode."""
        params = CreateImageJobRequest(
            images=[ImageEntry(image_id="test1234", boxes=[SegmentBox(x=0, y=0, w=10, h=10)])],
            remove_bg_mode=RemoveBgMode.CONSERVATIVE,
        )
        dumped = params.model_dump(mode="json")
        assert dumped["remove_bg_mode"] == "conservative"

        restored = CreateImageJobRequest(**dumped)
        assert restored.remove_bg_mode == RemoveBgMode.CONSERVATIVE


class TestTimestampValidation:
    """CreateJobRequest must reject negative timestamps."""

    def test_rejects_negative_timestamp(self):
        with pytest.raises(ValueError):
            CreateJobRequest(video_id="vid12345", timestamps_ms=[-1.0])

    def test_accepts_zero_timestamp(self):
        params = CreateJobRequest(video_id="vid12345", timestamps_ms=[0.0])
        assert params.timestamps_ms == [0.0]
