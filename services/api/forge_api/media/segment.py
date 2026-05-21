from pathlib import Path

import cv2
import numpy as np


WHITE_THRESHOLD = 230
MIN_SEGMENT_AREA = 400
MERGE_GAP = 20
EDGE_PADDING = 4


def _merge_boxes(boxes: list[tuple[int, int, int, int]], gap: int) -> list[tuple[int, int, int, int]]:
    """合并间距小于 gap 像素的相邻包围盒。"""
    if not boxes:
        return []

    merged = list(boxes)
    changed = True
    while changed:
        changed = False
        result: list[tuple[int, int, int, int]] = []
        used = [False] * len(merged)

        for i, (x1, y1, w1, h1) in enumerate(merged):
            if used[i]:
                continue
            bx, by, bw, bh = x1, y1, w1, h1

            for j in range(i + 1, len(merged)):
                if used[j]:
                    continue
                x2, y2, w2, h2 = merged[j]

                # 检查两个包围盒在 x 和 y 方向上的间距
                overlap_x = (bx <= x2 + w2 + gap) and (x2 <= bx + bw + gap)
                overlap_y = (by <= y2 + h2 + gap) and (y2 <= by + bh + gap)

                if overlap_x and overlap_y:
                    nx = min(bx, x2)
                    ny = min(by, y2)
                    bw = max(bx + bw, x2 + w2) - nx
                    bh = max(by + bh, y2 + h2) - ny
                    bx, by = nx, ny
                    used[j] = True
                    changed = True

            result.append((bx, by, bw, bh))
        merged = result

    return merged


def detect_segments(image_path: Path) -> list[dict[str, int]]:
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("无法读取图片")

    h_img, w_img = image.shape[:2]

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    _, background = cv2.threshold(gray, WHITE_THRESHOLD, 255, cv2.THRESH_BINARY)
    foreground = cv2.bitwise_not(background)

    # 先闭运算填充精灵内部白色缝隙，再开运算去除噪点
    close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
    foreground = cv2.morphologyEx(foreground, cv2.MORPH_CLOSE, close_kernel, iterations=3)

    open_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    foreground = cv2.morphologyEx(foreground, cv2.MORPH_OPEN, open_kernel)

    # 膨胀连接临近区域
    dilate_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    foreground = cv2.dilate(foreground, dilate_kernel, iterations=1)

    contours, _ = cv2.findContours(foreground, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    raw_boxes: list[tuple[int, int, int, int]] = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        if w * h < MIN_SEGMENT_AREA:
            continue
        raw_boxes.append((x, y, w, h))

    merged = _merge_boxes(raw_boxes, MERGE_GAP)

    # 带边距裁切，不超出图片范围
    segments: list[dict[str, int]] = []
    for x, y, w, h in merged:
        px = max(0, x - EDGE_PADDING)
        py = max(0, y - EDGE_PADDING)
        pw = min(w_img - px, w + EDGE_PADDING * 2)
        ph = min(h_img - py, h + EDGE_PADDING * 2)
        segments.append({"x": int(px), "y": int(py), "w": int(pw), "h": int(ph)})

    segments.sort(key=lambda item: (item["y"], item["x"]))
    return segments
