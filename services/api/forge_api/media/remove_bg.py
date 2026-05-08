import numpy as np
import cv2

_rembg_session = None


def get_rembg_session():
    global _rembg_session
    if _rembg_session is None:
        from rembg import new_session
        _rembg_session = new_session("u2net")
    return _rembg_session


def preload_model():
    get_rembg_session()


def remove_background(frame: np.ndarray) -> np.ndarray:
    from rembg import remove

    session = get_rembg_session()

    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    result = remove(
        rgb_frame,
        session=session,
        bgcolor=None,
    )

    return result
