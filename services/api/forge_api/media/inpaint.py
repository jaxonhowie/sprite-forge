import numpy as np
import cv2
from typing import Tuple


def build_mask(
    width: int,
    height: int,
    box: dict,
) -> np.ndarray:
    mask = np.zeros((height, width), dtype=np.uint8)
    
    x = int(box["x"] * width)
    y = int(box["y"] * height)
    w = int(box["w"] * width)
    h = int(box["h"] * height)
    
    x = max(0, min(x, width))
    y = max(0, min(y, height))
    w = max(0, min(w, width - x))
    h = max(0, min(h, height - y))
    
    mask[y:y+h, x:x+w] = 255
    
    return mask


def inpaint_frame(
    frame: np.ndarray,
    mask: np.ndarray,
    radius: int = 3,
) -> np.ndarray:
    return cv2.inpaint(
        frame,
        mask,
        radius,
        cv2.INPAINT_TELEA,
    )
