"""
Predictor — Inference wrapper for the Deepfake detector.
Integrates:
  • Real PyTorch CNN-LSTM (when torch and weights are present)
  • Real Computer Vision Forensics (FFT spectral anomaly, Laplacian texture residual,
    YCbCr chrominance inconsistency, temporal optical flow jitter, blink detection)
"""

import os
import time
import numpy as np
from pathlib import Path
from typing import Optional

from model.forensics_detector import ForensicsDetector

# ─── Attempt PyTorch import ───
try:
    import torch
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False

WEIGHTS_PATH = Path(__file__).parent / 'weights' / 'deepfake_cnnlstm.pth'
NUM_FRAMES   = 20
TARGET_SIZE  = 224


class DeepfakePredictor:
    """
    Inference wrapper. Automatically selects CNN-LSTM or Forensics engine.
    """

    def __init__(self):
        self.mode = 'forensics'
        self.model = None
        self.device = 'cpu'
        self.forensics = ForensicsDetector()
        self._try_load_model()

    def _try_load_model(self):
        """Try to load the real model; fall back to real Forensics engine."""
        if not TORCH_AVAILABLE:
            print("[Predictor] PyTorch not installed — running with Real CV Forensics Engine.")
            return

        if not WEIGHTS_PATH.exists():
            print(f"[Predictor] Weights not found at {WEIGHTS_PATH} — running with Real CV Forensics Engine.")
            return

        try:
            from model.cnn_lstm import build_model
            self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
            self.model  = build_model(pretrained=False, freeze_cnn=False)
            state = torch.load(str(WEIGHTS_PATH), map_location=self.device)
            self.model.load_state_dict(state)
            self.model.eval()
            self.model.to(self.device)
            self.mode = 'cnn_lstm'
            print(f"[Predictor] Model loaded on {self.device} — CNN-LSTM mode.")
        except Exception as e:
            print(f"[Predictor] Could not load model: {e} — using Real CV Forensics Engine.")
            self.model = None
            self.mode  = 'forensics'

    # ─── Public API ───

    def analyze(self, video_path: str) -> dict:
        """
        Analyze a video file for deepfake content using real computer vision and temporal forensics.
        """
        t0 = time.time()

        if self.mode == 'cnn_lstm' and self.model is not None:
            result = self._real_inference(video_path)
            result['model'] = 'EfficientNet-B0 + Bi-LSTM'
        else:
            result = self.forensics.analyze_video(video_path, max_frames=NUM_FRAMES)
            result['model'] = 'Spatial-Temporal CV Forensics (FFT + Texture + Jitter)'

        result['process_time'] = round(time.time() - t0, 2)
        result['mode'] = self.mode
        return result

    # ─── Real Inference ───

    def _real_inference(self, video_path: str) -> dict:
        """Run the actual CNN-LSTM model on the video."""
        from utils.video_processor import preprocess_video

        tensor_np, meta = preprocess_video(video_path, NUM_FRAMES, TARGET_SIZE)
        x = torch.from_numpy(tensor_np).unsqueeze(0).to(self.device)

        with torch.no_grad():
            out   = self.model(x)
            probs = out['probs'][0].cpu().numpy()

        fake_score = float(probs[1])
        frame_feats = out['frame_feats'][0].cpu().numpy()
        frame_norms = np.linalg.norm(frame_feats, axis=1)
        frame_norms_norm = (frame_norms - frame_norms.min()) / (frame_norms.ptp() + 1e-8)
        frame_scores = list(np.clip(
            fake_score + (frame_norms_norm - 0.5) * 0.3,
            0.01, 0.99
        ).astype(float))

        return self._build_result(frame_scores)

    # ─── Single Frame (Live Detection) ───

    def analyze_single_frame(self, img_bytes: bytes) -> dict:
        """
        Analyze a single JPEG frame using real FFT & texture signal analysis.
        """
        return self.forensics.analyze_single_frame(img_bytes)

    # ─── Helpers ───

    def _build_result(self, frame_scores: list) -> dict:
        avg_fake    = round(float(np.mean(frame_scores)), 4)
        fake_frames = sum(1 for s in frame_scores if s >= 0.5)
        return {
            'verdict'       : 'FAKE' if avg_fake >= 0.5 else 'REAL',
            'avg_fake_score': avg_fake,
            'frame_scores'  : frame_scores,
            'fake_frames'   : fake_frames,
            'real_frames'   : len(frame_scores) - fake_frames,
            'frame_count'   : len(frame_scores),
        }

    # ─── Helpers ───

    def _build_result(self, frame_scores: list) -> dict:
        avg_fake    = round(float(np.mean(frame_scores)), 4)
        fake_frames = sum(1 for s in frame_scores if s >= 0.5)
        return {
            'verdict'       : 'FAKE' if avg_fake >= 0.5 else 'REAL',
            'avg_fake_score': avg_fake,
            'frame_scores'  : frame_scores,
            'fake_frames'   : fake_frames,
            'real_frames'   : NUM_FRAMES - fake_frames,
            'frame_count'   : NUM_FRAMES,
        }


# Singleton instance
_predictor: Optional[DeepfakePredictor] = None


def get_predictor() -> DeepfakePredictor:
    global _predictor
    if _predictor is None:
        _predictor = DeepfakePredictor()
    return _predictor
