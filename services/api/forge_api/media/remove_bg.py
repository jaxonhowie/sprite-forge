import numpy as np
import cv2

_rembg_session = None
WHITE_BG_BORDER_RATIO = 0.03
WHITE_BG_MIN_BORDER = 2
WHITE_BG_MAX_BORDER = 24
WHITE_BG_BASE_DELTA = 24.0
WHITE_BG_MAX_DELTA = 42.0
WHITE_BG_VALUE_FLOOR = 136
WHITE_BG_MAX_SATURATION = 64
WHITE_BG_EFFECT_SATURATION = 56
WHITE_BG_PROTECT_MIN_AREA_RATIO = 0.002
WHITE_BG_PROTECT_MIN_AREA = 24

SOLID_BG_BORDER_RATIO = 0.03
SOLID_BG_MIN_BORDER = 2
SOLID_BG_MAX_BORDER = 24
SOLID_BG_BASE_DELTA = 28.0
SOLID_BG_MAX_DELTA = 64.0
SOLID_BG_VARIANCE_SCALE = 1.6
SOLID_BG_PROTECT_DELTA = 24.0
SOLID_BG_PROTECT_MIN_AREA_RATIO = 0.002
SOLID_BG_PROTECT_MIN_AREA = 24
SOLID_BG_STRICT_DELTA = 12.0


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


def _build_white_bg_subject_mask(
    delta: np.ndarray,
    value: np.ndarray,
    saturation: np.ndarray,
    background_value: float,
    background_saturation: float,
) -> np.ndarray:
    height, width = delta.shape[:2]
    protect_delta = 18.0
    protect_value = max(0, int(background_value - 18))
    protect_saturation = max(28, int(background_saturation + 14))

    seed = (
        (delta >= protect_delta)
        | (value <= protect_value)
        | (saturation >= protect_saturation)
    ).astype(np.uint8)

    seed = cv2.morphologyEx(
        seed,
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2)),
    )
    seed = cv2.morphologyEx(
        seed,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)),
        iterations=2,
    )
    seed = cv2.dilate(
        seed,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)),
        iterations=1,
    )

    contours, _ = cv2.findContours(seed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_area = max(WHITE_BG_PROTECT_MIN_AREA, int(height * width * WHITE_BG_PROTECT_MIN_AREA_RATIO))
    subject_mask = np.zeros((height, width), dtype=np.uint8)
    for contour in contours:
        if cv2.contourArea(contour) < min_area:
            continue
        cv2.drawContours(subject_mask, [contour], -1, 1, thickness=cv2.FILLED)

    return subject_mask.astype(bool)


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
    delta_threshold = min(WHITE_BG_MAX_DELTA, WHITE_BG_BASE_DELTA + lab_variance * 0.55)
    value_floor = max(WHITE_BG_VALUE_FLOOR, int(background_value - 42))
    saturation_ceiling = max(WHITE_BG_MAX_SATURATION, int(background_saturation + 28))

    lab_frame = cv2.cvtColor(rgb_frame, cv2.COLOR_RGB2LAB).astype(np.float32)
    hsv_frame = cv2.cvtColor(rgb_frame, cv2.COLOR_RGB2HSV)
    value = hsv_frame[:, :, 2]
    saturation = hsv_frame[:, :, 1]
    delta = np.linalg.norm(lab_frame - background_lab.astype(np.float32), axis=2)
    subject_mask = _build_white_bg_subject_mask(
        delta,
        value,
        saturation,
        background_value,
        background_saturation,
    )

    candidate_mask = (
        (delta <= delta_threshold)
        & (value >= value_floor)
        & (saturation <= saturation_ceiling)
        & ~subject_mask
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
    background_mask &= ~subject_mask

    alpha = np.where(background_mask, 0, 255).astype(np.uint8)
    alpha = cv2.GaussianBlur(alpha, (0, 0), sigmaX=1.0, sigmaY=1.0)
    rgba_frame[:, :, 3] = alpha
    return rgba_frame


def _build_solid_bg_subject_mask(delta: np.ndarray) -> np.ndarray:
    """构建主体核心掩码：高反差种子去噪后保留大面积连通域。

    不填充轮廓孔洞、不向外扩张，否则发丝间隙等被主体包围的背景色
    区域会被误判为主体而保留下来。
    """
    height, width = delta.shape[:2]

    seed = (delta >= SOLID_BG_PROTECT_DELTA).astype(np.uint8)
    seed = cv2.morphologyEx(
        seed,
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2)),
    )
    seed = cv2.morphologyEx(
        seed,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)),
        iterations=2,
    )

    component_count, labels = cv2.connectedComponents(seed)
    min_area = max(SOLID_BG_PROTECT_MIN_AREA, int(height * width * SOLID_BG_PROTECT_MIN_AREA_RATIO))
    subject_mask = np.zeros((height, width), dtype=bool)
    for label in range(1, component_count):
        if int((labels == label).sum()) >= min_area:
            subject_mask |= labels == label

    return subject_mask


def _remove_solid_color_background(frame: np.ndarray) -> np.ndarray:
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    rgba_frame = cv2.cvtColor(rgb_frame, cv2.COLOR_RGB2RGBA)
    height, width = rgb_frame.shape[:2]
    border = max(
        SOLID_BG_MIN_BORDER,
        min(SOLID_BG_MAX_BORDER, int(round(min(height, width) * SOLID_BG_BORDER_RATIO))),
    )

    border_pixels = _sample_border_pixels(rgb_frame, border)
    border_lab = cv2.cvtColor(border_pixels.reshape(1, -1, 3), cv2.COLOR_RGB2LAB).reshape(-1, 3)

    background_lab = np.median(border_lab, axis=0)
    lab_variance = float(np.percentile(np.linalg.norm(border_lab - background_lab, axis=1), 90))
    delta_threshold = min(
        SOLID_BG_MAX_DELTA,
        SOLID_BG_BASE_DELTA + lab_variance * SOLID_BG_VARIANCE_SCALE,
    )

    lab_frame = cv2.cvtColor(rgb_frame, cv2.COLOR_RGB2LAB).astype(np.float32)
    delta = np.linalg.norm(lab_frame - background_lab.astype(np.float32), axis=2)
    subject_mask = _build_solid_bg_subject_mask(delta)

    # 颜色距离渐变 alpha：与背景色几乎一致的像素直接透明，
    # 不再要求与图像边缘连通，被主体包围的背景色区域（如发丝间隙）也能去除。
    alpha = np.clip(
        (delta - SOLID_BG_STRICT_DELTA) / max(delta_threshold - SOLID_BG_STRICT_DELTA, 1e-6),
        0.0,
        1.0,
    )
    # 主体核心中真正高反差的像素强制不透明；核心内仍接近背景色的像素保持渐变。
    alpha[subject_mask & (delta >= SOLID_BG_PROTECT_DELTA)] = 1.0

    alpha_u8 = (alpha * 255).astype(np.uint8)
    alpha_u8 = cv2.GaussianBlur(alpha_u8, (0, 0), sigmaX=1.0, sigmaY=1.0)

    # 半透明边缘的背景色溢出抑制，消除残留绿边。
    red = rgb_frame[:, :, 0].astype(np.int16)
    green = rgb_frame[:, :, 1].astype(np.int16)
    blue = rgb_frame[:, :, 2].astype(np.int16)
    spill = (green > np.maximum(red, blue)) & (alpha_u8 < 255)
    if np.any(spill):
        green[spill] = np.maximum(red, blue)[spill]
        rgb_frame = np.stack(
            [red, green, blue], axis=2
        ).astype(np.uint8)
        rgba_frame = cv2.cvtColor(rgb_frame, cv2.COLOR_RGB2RGBA)

    rgba_frame[:, :, 3] = alpha_u8
    return rgba_frame


def remove_background(frame: np.ndarray, mode: str = "standard") -> np.ndarray:
    if mode == "white":
        return _remove_white_background(frame)
    if mode == "solid":
        return _remove_solid_color_background(frame)

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
