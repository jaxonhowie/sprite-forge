"""Tests for store._validate_id and path-traversal protection (S1/S2)."""
import pytest

from forge_api import store


class TestValidateId:
    def test_accepts_valid_hex_id(self):
        assert store._validate_id("abcdef12", "video_id") == "abcdef12"

    def test_accepts_job_prefix(self):
        assert store._validate_id("j_abcd1234", "job_id") == "j_abcd1234"

    def test_accepts_image_job_prefix(self):
        assert store._validate_id("ij_abcd1234", "job_id") == "ij_abcd1234"

    def test_rejects_dotdot(self):
        with pytest.raises(ValueError, match="非法"):
            store._validate_id("..", "job_id")

    def test_rejects_path_traversal(self):
        with pytest.raises(ValueError):
            store._validate_id("../../etc/passwd", "video_id")

    def test_rejects_slash(self):
        with pytest.raises(ValueError):
            store._validate_id("foo/bar", "image_id")

    def test_rejects_empty(self):
        with pytest.raises(ValueError):
            store._validate_id("", "job_id")

    def test_rejects_none(self):
        with pytest.raises(ValueError):
            store._validate_id(None, "job_id")  # type: ignore[arg-type]

    def test_rejects_too_long(self):
        with pytest.raises(ValueError):
            store._validate_id("a" * 65, "job_id")

    def test_rejects_spaces(self):
        with pytest.raises(ValueError):
            store._validate_id("has space", "job_id")

    def test_rejects_special_chars(self):
        for bad in ["../..", ".", "..", "%2e%2e", "job\x00id"]:
            with pytest.raises(ValueError):
                store._validate_id(bad, "job_id")


class TestDeleteJobTraversal:
    """delete_job must never escape JOBS_DIR (S1)."""

    def test_delete_job_dotdot_raises(self):
        with pytest.raises(ValueError):
            store.delete_job("..")

    def test_delete_job_dotdot_does_not_delete_parent(self, isolated_data_dir):
        # delete_job("..") raises ValueError before any rmtree, so parent survives.
        with pytest.raises(ValueError):
            store.delete_job("..")
        assert isolated_data_dir.exists()
        assert (isolated_data_dir / "jobs").exists()

    def test_delete_video_dotdot_raises(self):
        with pytest.raises(ValueError):
            store.delete_video("..")

    def test_delete_image_dotdot_raises(self):
        with pytest.raises(ValueError):
            store.delete_image("..")


class TestGetMetaTraversal:
    """get_*_meta / get_*_path must reject traversal (S2)."""

    @pytest.mark.parametrize("bad_id", ["..", "../../etc", "foo/bar", ""])
    def test_get_video_meta_rejects_traversal(self, bad_id):
        with pytest.raises(ValueError):
            store.get_video_meta(bad_id)

    @pytest.mark.parametrize("bad_id", ["..", "../../etc", "foo/bar", ""])
    def test_get_video_path_rejects_traversal(self, bad_id):
        with pytest.raises(ValueError):
            store.get_video_path(bad_id)

    @pytest.mark.parametrize("bad_id", ["..", "../../etc", "foo/bar", ""])
    def test_get_image_meta_rejects_traversal(self, bad_id):
        with pytest.raises(ValueError):
            store.get_image_meta(bad_id)

    @pytest.mark.parametrize("bad_id", ["..", "../../etc", "foo/bar", ""])
    def test_get_job_rejects_traversal(self, bad_id):
        with pytest.raises(ValueError):
            store.get_job(bad_id)

    @pytest.mark.parametrize("bad_id", ["..", "../../etc", "foo/bar", ""])
    def test_get_image_job_rejects_traversal(self, bad_id):
        with pytest.raises(ValueError):
            store.get_image_job(bad_id)

    @pytest.mark.parametrize("bad_id", ["..", "../../etc", "foo/bar", ""])
    def test_get_job_dir_rejects_traversal(self, bad_id):
        with pytest.raises(ValueError):
            store.get_job_dir(bad_id)
