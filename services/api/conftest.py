"""Pytest configuration: redirect DATA_DIR to a temp directory so tests never touch real data."""
import shutil
import tempfile
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def isolated_data_dir(monkeypatch, tmp_path):
    """Redirect all store paths to a temp directory for test isolation."""
    from forge_api import store

    tmp_data = tmp_path / "data"
    tmp_data.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(store, "DATA_DIR", tmp_data)
    monkeypatch.setattr(store, "UPLOADS_DIR", tmp_data / "uploads")
    monkeypatch.setattr(store, "IMAGES_DIR", tmp_data / "images")
    monkeypatch.setattr(store, "JOBS_DIR", tmp_data / "jobs")
    monkeypatch.setattr(store, "IMAGE_JOBS_DIR", tmp_data / "image_jobs")
    monkeypatch.setattr(store, "TMP_DIR", tmp_data / "tmp")

    store.ensure_dirs()
    yield tmp_data
