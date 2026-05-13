import subprocess
import uuid
import json
from pathlib import Path
from typing import Optional
import numpy as np
import cv2
from PIL import Image

from .. import store


def clamp_capture_timestamp_ms(timestamp_ms: float, duration_ms: float, fps: float) -> float:
    if duration_ms <= 0:
        return max(0.0, timestamp_ms)

    safe_fps = fps if fps > 0 else 30.0
    frame_duration_ms = max(1000.0 / safe_fps, 1.0)
    safe_upper_bound = max(0.0, duration_ms - frame_duration_ms)
    return max(0.0, min(timestamp_ms, safe_upper_bound))


def extract_frame_with_retry(
    video_path: Path,
    timestamp_ms: float,
    duration_ms: float,
    fps: float,
    output_path: Optional[Path] = None,
) -> tuple[np.ndarray, float]:
    safe_fps = fps if fps > 0 else 30.0
    frame_duration_ms = max(1000.0 / safe_fps, 1.0)
    clamped_ts = clamp_capture_timestamp_ms(timestamp_ms, duration_ms, safe_fps)

    attempted: set[int] = set()
    last_error: Optional[Exception] = None

    for step in range(6):
        candidate_ts = max(0.0, clamped_ts - (step * frame_duration_ms))
        rounded_candidate = int(round(candidate_ts))
        if rounded_candidate in attempted:
            continue
        attempted.add(rounded_candidate)

        try:
            return extract_frame(video_path, candidate_ts, output_path), candidate_ts
        except Exception as exc:
            last_error = exc

    if last_error:
        raise last_error
    raise RuntimeError(f"无法截取视频帧 (ts={timestamp_ms}ms)")


def _try_ffmpeg(video_path: Path, args: list[str], tmp_path: Path) -> subprocess.CompletedProcess:
    cmd = ["ffmpeg", "-y"] + args + [str(tmp_path)]
    return subprocess.run(cmd, capture_output=True, timeout=30)


def _has_valid_output(path: Path) -> bool:
    return path.exists() and path.stat().st_size > 1024


def _extract_with_fallbacks(video_path: Path, timestamp_sec: float, tmp_path: Path) -> subprocess.CompletedProcess:
    strategies = [
        ["-ss", str(timestamp_sec), "-i", str(video_path), "-frames:v", "1"],
        ["-i", str(video_path), "-ss", str(timestamp_sec), "-frames:v", "1"],
    ]

    last_result = None
    for args in strategies:
        tmp_path.unlink(missing_ok=True)
        result = _try_ffmpeg(video_path, args, tmp_path)
        if _has_valid_output(tmp_path):
            return result
        last_result = result

    return last_result


def extract_frame(
    video_path: Path,
    timestamp_ms: float,
    output_path: Optional[Path] = None,
) -> np.ndarray:
    timestamp_sec = timestamp_ms / 1000.0

    tmp_dir = store.DATA_DIR / "tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp_path = tmp_dir / f"_frame_{uuid.uuid4().hex[:8]}.png"

    try:
        result = _extract_with_fallbacks(video_path, timestamp_sec, tmp_path)

        if not _has_valid_output(tmp_path):
            stderr_tail = result.stderr.decode()[-300:] if result else "no result"
            raise RuntimeError(
                f"ffmpeg 截帧失败 (ts={timestamp_ms}ms): {stderr_tail}"
            )

        frame = cv2.imread(str(tmp_path), cv2.IMREAD_COLOR)

        if frame is None:
            try:
                pil_img = Image.open(str(tmp_path)).convert("RGB")
                frame = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
            except Exception as pil_err:
                file_size = tmp_path.stat().st_size
                raise RuntimeError(
                    f"无法解码帧数据 (ts={timestamp_ms}ms, 大小={file_size}B, "
                    f"cv2=None, pil={pil_err}, 路径={tmp_path})"
                )

        if output_path:
            cv2.imwrite(str(output_path), frame)

        return frame
    finally:
        tmp_path.unlink(missing_ok=True)


def save_frame_preview(frame: np.ndarray, output_path: Path, max_width: int = 320) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)

    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    image = Image.fromarray(rgb_frame)

    if image.width > max_width:
        target_height = max(1, round((image.height * max_width) / image.width))
        image = image.resize((max_width, target_height), Image.Resampling.LANCZOS)

    image.save(output_path, format="PNG", optimize=True)


def get_video_info(video_path: Path) -> dict:
    cmd = [
        "ffprobe",
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        str(video_path),
    ]

    result = subprocess.run(cmd, capture_output=True, check=True, timeout=30)

    data = json.loads(result.stdout)

    video_stream = None
    for stream in data.get("streams", []):
        if stream.get("codec_type") == "video":
            video_stream = stream
            break

    if not video_stream:
        raise RuntimeError("未找到视频流")

    fps_str = video_stream.get("r_frame_rate", "30/1")
    if "/" in fps_str:
        num, den = fps_str.split("/")
        fps = float(num) / float(den)
    else:
        fps = float(fps_str)

    duration_ms = float(data.get("format", {}).get("duration", 0)) * 1000

    return {
        "width": int(video_stream.get("width", 0)),
        "height": int(video_stream.get("height", 0)),
        "fps": fps,
        "duration_ms": duration_ms,
    }
