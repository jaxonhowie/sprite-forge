from pathlib import Path

import cv2


WHITE_THRESHOLD = 245
MIN_SEGMENT_AREA = 400


def detect_segments(image_path: Path) -> list[dict[str, int]]:
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("无法读取图片")

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    _, background = cv2.threshold(gray, WHITE_THRESHOLD, 255, cv2.THRESH_BINARY)
    foreground = cv2.bitwise_not(background)

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    foreground = cv2.morphologyEx(foreground, cv2.MORPH_OPEN, kernel)
    foreground = cv2.morphologyEx(foreground, cv2.MORPH_CLOSE, kernel)

    contours, _ = cv2.findContours(foreground, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    segments: list[dict[str, int]] = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        area = w * h
        if area < MIN_SEGMENT_AREA:
            continue
        segments.append({"x": int(x), "y": int(y), "w": int(w), "h": int(h)})

    segments.sort(key=lambda item: (item["y"], item["x"]))
    return segments
