import subprocess
import tempfile
from pathlib import Path
from typing import Optional
import numpy as np
import cv2


def extract_frame(
    video_path: Path,
    timestamp_ms: int,
    output_path: Optional[Path] = None,
) -> np.ndarray:
    timestamp_sec = timestamp_ms / 1000.0

    tmp_file = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    tmp_path = tmp_file.name
    tmp_file.close()

    try:
        cmd = [
            "ffmpeg",
            "-y",
            "-i", str(video_path),
            "-ss", str(timestamp_sec),
            "-frames:v", "1",
            "-pix_fmt", "rgb24",
            tmp_path,
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            timeout=30,
        )

        if result.returncode != 0 or not Path(tmp_path).exists():
            raise RuntimeError(
                f"ffmpeg 截帧失败 (ts={timestamp_ms}ms): {result.stderr.decode()[-300:]}"
            )

        frame = cv2.imread(tmp_path, cv2.IMREAD_COLOR)
        if frame is None:
            raise RuntimeError(f"无法解码帧数据 (ts={timestamp_ms}ms)")

        if output_path:
            cv2.imwrite(str(output_path), frame)

        return frame
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def get_video_info(video_path: Path) -> dict:
    cmd = [
        "ffprobe",
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        str(video_path),
    ]
    
    result = subprocess.run(
        cmd,
        capture_output=True,
        check=True,
        timeout=30,
    )
    
    import json
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
