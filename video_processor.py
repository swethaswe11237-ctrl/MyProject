"""
Video Processor — Frame extraction and face detection utilities
"""

import cv2
import numpy as np
from pathlib import Path
from typing import List, Tuple, Optional


# ImageNet normalization constants
IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD  = [0.229, 0.224, 0.225]

# OpenCV Haar Cascade for face detection (bundled with OpenCV)
_FACE_CASCADE = None


def get_face_cascade() -> cv2.CascadeClassifier:
    global _FACE_CASCADE
    if _FACE_CASCADE is None:
        cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
        _FACE_CASCADE = cv2.CascadeClassifier(cascade_path)
    return _FACE_CASCADE


def extract_frames(
    video_path: str,
    num_frames: int = 20,
) -> Tuple[List[np.ndarray], dict]:
    """
    Uniformly sample `num_frames` frames from a video file.

    Returns:
        frames  : list of BGR numpy arrays (H, W, 3)
        metadata: dict with fps, total_frames, duration_sec
    """
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {video_path}")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps          = cap.get(cv2.CAP_PROP_FPS) or 25.0
    duration_sec = total_frames / fps

    # Compute uniform sample indices
    if total_frames <= num_frames:
        indices = list(range(total_frames))
    else:
        indices = [int(i * total_frames / num_frames) for i in range(num_frames)]

    frames = []
    for idx in indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ret, frame = cap.read()
        if ret and frame is not None:
            frames.append(frame)

    cap.release()

    metadata = {
        'fps'         : fps,
        'total_frames': total_frames,
        'duration_sec': duration_sec,
        'sampled'     : len(frames),
    }
    return frames, metadata


def detect_and_crop_face(
    frame     : np.ndarray,
    target_size: int = 224,
    padding   : float = 0.2,
) -> Optional[np.ndarray]:
    """
    Detect the largest face in a BGR frame and return a cropped+resized region.
    Falls back to center-crop if no face detected.

    Returns:
        RGB numpy array [target_size, target_size, 3] or None
    """
    gray    = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    cascade = get_face_cascade()
    faces   = cascade.detectMultiScale(
        gray,
        scaleFactor = 1.1,
        minNeighbors= 5,
        minSize     = (60, 60),
    )

    H, W = frame.shape[:2]

    if len(faces) == 0:
        # Fall back to center crop
        size  = min(H, W)
        y_off = (H - size) // 2
        x_off = (W - size) // 2
        crop  = frame[y_off:y_off+size, x_off:x_off+size]
    else:
        # Pick largest face
        areas = [w * h for (x, y, w, h) in faces]
        x, y, w, h = faces[np.argmax(areas)]

        # Add padding
        pad_x = int(w * padding)
        pad_y = int(h * padding)
        x1 = max(0, x - pad_x)
        y1 = max(0, y - pad_y)
        x2 = min(W, x + w + pad_x)
        y2 = min(H, y + h + pad_y)
        crop = frame[y1:y2, x1:x2]

    # Resize to target
    crop_rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
    resized  = cv2.resize(crop_rgb, (target_size, target_size))
    return resized


def normalize_frame(frame_rgb: np.ndarray) -> np.ndarray:
    """
    Normalize a [H, W, 3] uint8 RGB array to ImageNet-normalized float32.
    Returns [3, H, W] float32 array (PyTorch channel-first format).
    """
    img = frame_rgb.astype(np.float32) / 255.0
    mean = np.array(IMAGENET_MEAN, dtype=np.float32)
    std  = np.array(IMAGENET_STD,  dtype=np.float32)
    img  = (img - mean) / std
    return img.transpose(2, 0, 1)  # HWC → CHW


def preprocess_video(
    video_path : str,
    num_frames : int = 20,
    target_size: int = 224,
) -> Tuple[np.ndarray, dict]:
    """
    Full preprocessing pipeline: extract → detect faces → normalize.

    Returns:
        tensor_np : float32 ndarray [T, 3, 224, 224]  (model-ready)
        metadata  : video metadata dict
    """
    frames, meta = extract_frames(video_path, num_frames)
    if not frames:
        raise ValueError("No frames could be extracted from the video.")

    processed = []
    for frame in frames:
        face = detect_and_crop_face(frame, target_size)
        if face is not None:
            norm = normalize_frame(face)
            processed.append(norm)

    if not processed:
        raise ValueError("No faces detected in any frame.")

    # Pad/trim to exactly num_frames
    while len(processed) < num_frames:
        processed.append(processed[-1])  # repeat last frame
    processed = processed[:num_frames]

    tensor_np = np.stack(processed, axis=0)  # [T, 3, H, W]
    meta['faces_detected'] = True
    return tensor_np, meta
