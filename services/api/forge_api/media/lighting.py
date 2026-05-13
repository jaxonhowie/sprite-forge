from typing import Iterable

import cv2
import numpy as np


MIN_STD = 1.0
MAX_SCALE = 1.25
MIN_SCALE = 0.85
MAX_SHIFT = 24.0


def _luminance_stats(frame: np.ndarray) -> tuple[float, float]:
    bgr_frame = frame[:, :, :3] if frame.ndim == 3 and frame.shape[2] == 4 else frame
    lab = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2LAB)
    lightness = lab[:, :, 0].astype(np.float32)
    return float(lightness.mean()), float(lightness.std())


def estimate_target_lighting(frames: Iterable[np.ndarray]) -> tuple[float, float]:
    means: list[float] = []
    stds: list[float] = []

    for frame in frames:
        mean, std = _luminance_stats(frame)
        means.append(mean)
        stds.append(max(std, MIN_STD))

    if not means:
        raise ValueError("没有可用于灯光统一的帧")

    return float(np.median(means)), float(np.median(stds))


def normalize_frame_lighting(
    frame: np.ndarray,
    target_mean: float,
    target_std: float,
) -> np.ndarray:
    alpha = None
    bgr_frame = frame
    if frame.ndim == 3 and frame.shape[2] == 4:
        alpha = frame[:, :, 3:4]
        bgr_frame = frame[:, :, :3]

    lab = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2LAB)
    lightness = lab[:, :, 0].astype(np.float32)

    current_mean = float(lightness.mean())
    current_std = max(float(lightness.std()), MIN_STD)

    scale = np.clip(target_std / current_std, MIN_SCALE, MAX_SCALE)
    shift = np.clip(target_mean - current_mean, -MAX_SHIFT, MAX_SHIFT)

    normalized = ((lightness - current_mean) * scale) + current_mean + shift
    lab[:, :, 0] = np.clip(normalized, 0, 255).astype(np.uint8)

    normalized_bgr = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
    if alpha is None:
        return normalized_bgr

    return np.concatenate((normalized_bgr, alpha), axis=2)
