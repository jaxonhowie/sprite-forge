import numpy as np
import cv2

_rembg_session = None
WHITE_BG_BORDER_RATIO = 0.03
WHITE_BG_MIN_BORDER = 2
WHITE_BG_MAX_BORDER = 24
WHITE_BG_BASE_DELTA = 18.0
WHITE_BG_MAX_DELTA = 30.0
WHITE_BG_VALUE_FLOOR = 150
WHITE_BG_MAX_SATURATION = 48
WHITE_BG_EFFECT_SATURATION = 56


def _protect_red_effects(rgb_frame: np.ndarray, rgba_result: np.ndarray) -> np.ndarray:
    rgba_result = np.array(rgba_result, copy=True)
    if rgba_result.ndim != 3 or rgba_result.shape[2] < 4:
        alpha = np.full(rgba_result.shape[:2], 255, dtype=np.uint8)
        rgba_result = np.dstack((rgba_result[:, :, :3], alpha))

    hsv = cv2.cvtColor(rgb_frame, cv2.COLOR_RGB2HSV)
    hue = hsv[:, :, 0]
    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]
    red = rgb_frame[:, :, 0].astype(np.int16)
    green = rgb_frame[:, :, 1].astype(np.int16)
    blue = rgb_frame[:, :, 2].astype(np.int16)

    red_or_orange_hue = (hue <= 24) | (hue >= 165)
    red_dominant = (red > green + 18) & (red > blue + 8)
    bright_saturated = (saturation >= 70) & (value >= 45)
    effect_mask = (red_or_orange_hue & red_dominant & bright_saturated).astype(np.uint8) * 255

    if not np.any(effect_mask):
        return rgba_result

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    core_mask = cv2.morphologyEx(effect_mask, cv2.MORPH_CLOSE, kernel)
    expanded_mask = cv2.dilate(core_mask, kernel, iterations=1)
    feathered_mask = cv2.GaussianBlur(expanded_mask, (0, 0), sigmaX=1.2, sigmaY=1.2)

    protected_alpha = np.maximum(core_mask, (feathered_mask * 0.75).astype(np.uint8))
    current_alpha = rgba_result[:, :, 3]
    rgba_result[:, :, 3] = np.maximum(current_alpha, protected_alpha)
    return rgba_result


def get_rembg_session():
    global _rembg_session
    if _rembg_session is None:
        from rembg import new_session
        _rembg_session = new_session("u2net")
    return _rembg_session


def preload_model():
    get_rembg_session()


def _sample_border_pixels(frame: np.ndarray, border: int) -> np.ndarray:
    top = frame[:border, :, :]
    bottom = frame[-border:, :, :]
    left = frame[border:-border or None, :border, :]
    right = frame[border:-border or None, -border:, :]
    return np.concatenate(
        [
            top.reshape(-1, 3),
            bottom.reshape(-1, 3),
            left.reshape(-1, 3),
            right.reshape(-1, 3),
        ],
        axis=0,
    )


def _remove_white_background(frame: np.ndarray) -> np.ndarray:
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    rgba_frame = cv2.cvtColor(rgb_frame, cv2.COLOR_RGB2RGBA)
    height, width = rgb_frame.shape[:2]
    border = max(
        WHITE_BG_MIN_BORDER,
        min(WHITE_BG_MAX_BORDER, int(round(min(height, width) * WHITE_BG_BORDER_RATIO))),
    )

    border_pixels = _sample_border_pixels(rgb_frame, border)
    border_lab = cv2.cvtColor(border_pixels.reshape(1, -1, 3), cv2.COLOR_RGB2LAB).reshape(-1, 3)
    border_hsv = cv2.cvtColor(border_pixels.reshape(1, -1, 3), cv2.COLOR_RGB2HSV).reshape(-1, 3)

    background_lab = np.median(border_lab, axis=0)
    background_value = float(np.median(border_hsv[:, 2]))
    background_saturation = float(np.median(border_hsv[:, 1]))
    lab_variance = float(np.percentile(np.linalg.norm(border_lab - background_lab, axis=1), 90))
    delta_threshold = min(WHITE_BG_MAX_DELTA, WHITE_BG_BASE_DELTA + lab_variance * 0.35)
    value_floor = max(WHITE_BG_VALUE_FLOOR, int(background_value - 28))
    saturation_ceiling = max(WHITE_BG_MAX_SATURATION, int(background_saturation + 18))

    lab_frame = cv2.cvtColor(rgb_frame, cv2.COLOR_RGB2LAB).astype(np.float32)
    hsv_frame = cv2.cvtColor(rgb_frame, cv2.COLOR_RGB2HSV)
    value = hsv_frame[:, :, 2]
    saturation = hsv_frame[:, :, 1]
    delta = np.linalg.norm(lab_frame - background_lab.astype(np.float32), axis=2)

    candidate_mask = (
        (delta <= delta_threshold)
        & (value >= value_floor)
        & (saturation <= saturation_ceiling)
    ).astype(np.uint8)
    candidate_mask = cv2.morphologyEx(
        candidate_mask,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)),
    )

    component_count, labels = cv2.connectedComponents(candidate_mask)
    background_labels = np.unique(
        np.concatenate(
            [
                labels[0, :],
                labels[-1, :],
                labels[:, 0],
                labels[:, -1],
            ]
        )
    )
    background_labels = background_labels[background_labels != 0]
    background_mask = np.isin(labels, background_labels)

    color_effect_mask = saturation >= WHITE_BG_EFFECT_SATURATION
    background_mask &= ~color_effect_mask

    alpha = np.where(background_mask, 0, 255).astype(np.uint8)
    alpha = cv2.GaussianBlur(alpha, (0, 0), sigmaX=1.0, sigmaY=1.0)
    rgba_frame[:, :, 3] = alpha
    return rgba_frame


def remove_background(frame: np.ndarray, mode: str = "standard") -> np.ndarray:
    if mode == "white":
        return _remove_white_background(frame)

    from rembg import remove

    session = get_rembg_session()

    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    remove_kwargs = {
        "session": session,
        "bgcolor": None,
    }

    if mode == "conservative":
        remove_kwargs.update({
            "alpha_matting": True,
            "alpha_matting_foreground_threshold": 220,
            "alpha_matting_background_threshold": 8,
            "alpha_matting_erode_size": 3,
        })

    result = remove(rgb_frame, **remove_kwargs)
    if mode == "conservative":
        result = _protect_red_effects(rgb_frame, result)

    return result
