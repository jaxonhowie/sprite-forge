import numpy as np
from PIL import Image
from typing import List, Tuple
import math


def pack_grid(
    frames: List[np.ndarray],
    cols: int = 8,
    padding: int = 2,
) -> Tuple[Image.Image, dict]:
    if not frames:
        raise ValueError("没有可打包的帧")
    
    pil_frames = []
    for frame in frames:
        if frame.ndim == 3 and frame.shape[2] == 4:
            pil_frame = Image.fromarray(frame, "RGBA")
        elif frame.ndim == 3 and frame.shape[2] == 3:
            pil_frame = Image.fromarray(frame, "RGB")
        else:
            pil_frame = Image.fromarray(frame)
        pil_frames.append(pil_frame)
    
    max_w = max(f.width for f in pil_frames)
    max_h = max(f.height for f in pil_frames)
    
    n = len(pil_frames)
    rows = math.ceil(n / cols)
    
    sheet_w = cols * max_w + (cols - 1) * padding
    sheet_h = rows * max_h + (rows - 1) * padding
    
    sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))
    
    frames_meta = []
    
    for i, frame in enumerate(pil_frames):
        col = i % cols
        row = i // cols
        
        x = col * (max_w + padding)
        y = row * (max_h + padding)
        
        if frame.mode != "RGBA":
            frame = frame.convert("RGBA")
        
        sheet.paste(frame, (x, y), frame if frame.mode == "RGBA" else None)
        
        frames_meta.append({
            "index": i,
            "x": x,
            "y": y,
            "w": frame.width,
            "h": frame.height,
        })
    
    meta = {
        "image": "spritesheet.png",
        "frame_size": {"w": max_w, "h": max_h},
        "padding": padding,
        "cols": cols,
        "rows": rows,
        "frames": frames_meta,
    }
    
    return sheet, meta
