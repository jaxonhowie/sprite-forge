"""Tests for media/lighting.py alpha-weighted luminance stats (S4 algorithm fix)."""
import numpy as np
import pytest

from forge_api.media.lighting import _luminance_stats, normalize_frame_lighting, estimate_target_lighting


class TestAlphaWeightedLuminance:
    """S4: _luminance_stats must weight by alpha so transparent regions don't bias the mean."""

    def test_opaque_frame_matches_unweighted(self):
        """Fully opaque frame should give consistent stats."""
        frame = np.zeros((10, 10, 4), dtype=np.uint8)
        frame[:, :, 0] = 100  # BGR
        frame[:, :, 3] = 255  # fully opaque
        mean, std = _luminance_stats(frame)
        assert mean > 0  # L* for a mid-blue pixel
        assert std >= 1.0  # MIN_STD floor applied for alpha path

    def test_transparent_region_excluded_from_stats(self):
        """A frame that is half-bright-opaque / half-transparent should weight only the opaque part."""
        frame = np.zeros((10, 20, 4), dtype=np.uint8)
        # Left half: bright + opaque
        frame[:, :10, 0] = 200
        frame[:, :10, 3] = 255
        # Right half: dark + transparent (should be excluded)
        frame[:, 10:, 0] = 0
        frame[:, 10:, 3] = 0

        weighted_mean, _ = _luminance_stats(frame)

        # Compare: stats on only the opaque left half
        opaque_only = frame[:, :10, :].copy()
        opaque_only_mean, _ = _luminance_stats(opaque_only)

        # Unweighted: force everything opaque (include the dark right half)
        unweighted_frame = frame.copy()
        unweighted_frame[:, :, 3] = 255
        unweighted_mean, _ = _luminance_stats(unweighted_frame)

        # The alpha-weighted mean should match the opaque-only mean exactly,
        # and be much higher than the unweighted mean (which includes dark transparent pixels).
        assert abs(weighted_mean - opaque_only_mean) < 1.0
        assert weighted_mean > unweighted_mean + 10.0

    def test_bgr_frame_fallback(self):
        """3-channel BGR frame (no alpha) should use unweighted stats without error."""
        frame = np.full((10, 10, 3), 128, dtype=np.uint8)
        mean, std = _luminance_stats(frame)
        assert mean > 0
        # Uniform frame has std=0 in the non-alpha path (no MIN_STD floor there).

    def test_estimate_target_lighting_with_alpha(self):
        """estimate_target_lighting should handle mixed-alpha frames without error."""
        frames = []
        for i in range(3):
            f = np.zeros((10, 10, 4), dtype=np.uint8)
            f[:, :, 0] = 100 + i * 20
            f[:, :, 3] = 255 if i % 2 == 0 else 0
            frames.append(f)
        mean, std = estimate_target_lighting(frames)
        assert 0 < mean < 255
        assert std >= 1.0

    def test_normalize_preserves_alpha_channel(self):
        """normalize_frame_lighting must return the same alpha channel it received."""
        frame = np.zeros((10, 10, 4), dtype=np.uint8)
        frame[:, :, 0] = 100
        frame[:, :, 3] = 128
        original_alpha = frame[:, :, 3].copy()

        result = normalize_frame_lighting(frame, 50.0, 10.0)
        assert result.shape == frame.shape
        np.testing.assert_array_equal(result[:, :, 3], original_alpha)
