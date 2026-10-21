"""
DeepGuard Flask API Server
Endpoints:
  GET  /api/health        — server liveness check
  POST /api/analyze       — upload video, get deepfake analysis
  POST /api/analyze_frame — single frame base64 image → fake probability
"""

import os
import base64
import io
import uuid
import logging
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
from werkzeug.utils import secure_filename

# ─── App Setup ───
FRONTEND_DIR = Path(__file__).parent.parent / 'frontend'

app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path='')
CORS(app, resources={r"/api/*": {"origins": "*"}})

logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(message)s')
log = logging.getLogger(__name__)

# ─── Config ───
UPLOAD_DIR = Path(__file__).parent / 'uploads'
UPLOAD_DIR.mkdir(exist_ok=True)

ALLOWED_EXTENSIONS = {'.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv'}
MAX_FILE_SIZE_MB   = 500
app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_SIZE_MB * 1024 * 1024


def allowed_file(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_EXTENSIONS


# ─── Frontend Routes ───

@app.route('/')
def serve_index():
    """Serve the main web app."""
    return send_from_directory(str(FRONTEND_DIR), 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    """Serve any frontend static file (css, js, images)."""
    full = FRONTEND_DIR / path
    if full.is_file():
        return send_from_directory(str(FRONTEND_DIR), path)
    # Fallback to index for SPA routing
    return send_from_directory(str(FRONTEND_DIR), 'index.html')


# ─── API Routes ───


@app.route('/api/health', methods=['GET'])
def health():
    """Liveness / readiness check."""
    from model.predictor import get_predictor
    predictor = get_predictor()
    return jsonify({
        'status'     : 'ok',
        'mode'       : predictor.mode,
        'model'      : 'EfficientNet-B0 + Bi-LSTM',
        'gpu_available': False,  # updated by predictor in real mode
    })


@app.route('/api/analyze', methods=['POST'])
def analyze():
    """
    Accepts a video file and returns deepfake analysis.

    Request:
        multipart/form-data  with field  'video'

    Response (200):
        {
          "verdict"        : "FAKE" | "REAL",
          "avg_fake_score" : 0.84,
          "frame_scores"   : [...20 floats...],
          "fake_frames"    : 17,
          "real_frames"    : 3,
          "frame_count"    : 20,
          "process_time"   : 2.1,
          "mode"           : "demo",
          "model"          : "EfficientNet-B0 + Bi-LSTM",
          "filename"       : "uploaded.mp4"
        }
    """
    if 'video' not in request.files:
        return jsonify({'error': 'No video field in request.'}), 400

    file = request.files['video']
    if file.filename == '':
        return jsonify({'error': 'No file selected.'}), 400

    filename = secure_filename(file.filename)
    if not allowed_file(filename):
        return jsonify({'error': f'Unsupported file type. Allowed: {", ".join(ALLOWED_EXTENSIONS)}'}), 415

    # Save to temp path with unique name
    unique_name = f"{uuid.uuid4().hex}_{filename}"
    save_path   = UPLOAD_DIR / unique_name

    try:
        file.save(str(save_path))
        log.info(f"Saved upload: {unique_name} ({save_path.stat().st_size // 1024} KB)")

        from model.predictor import get_predictor
        predictor = get_predictor()
        result    = predictor.analyze(str(save_path))
        result['filename'] = filename

        log.info(
            f"Analysis done: {filename} → {result['verdict']} "
            f"({result['avg_fake_score']*100:.1f}%) in {result['process_time']}s [{result['mode']}]"
        )
        return jsonify(result), 200

    except ValueError as e:
        log.warning(f"Analysis failed: {e}")
        return jsonify({'error': str(e)}), 422

    except Exception as e:
        log.error(f"Unexpected error: {e}", exc_info=True)
        return jsonify({'error': 'Internal server error.'}), 500

    finally:
        # Clean up uploaded file
        if save_path.exists():
            save_path.unlink()


@app.route('/api/analyze_frame', methods=['POST'])
def analyze_frame():
    """
    Accepts a single video frame as base64-encoded JPEG and returns fake probability.

    Request JSON:
        { "image": "data:image/jpeg;base64,..." }

    Response (200):
        { "fake_prob": 0.84, "verdict": "FAKE", "mode": "demo" }
    """
    data = request.get_json(force=True, silent=True)
    if not data or 'image' not in data:
        return jsonify({'error': 'JSON body with "image" (base64) required.'}), 400

    try:
        # Strip data-URL prefix if present
        b64 = data['image']
        if ',' in b64:
            b64 = b64.split(',', 1)[1]
        img_bytes = base64.b64decode(b64)

        from model.predictor import get_predictor
        predictor = get_predictor()
        result    = predictor.analyze_single_frame(img_bytes)
        return jsonify(result), 200

    except Exception as e:
        log.error(f'Frame analysis error: {e}', exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.errorhandler(413)
def file_too_large(e):
    return jsonify({'error': f'File too large. Maximum size: {MAX_FILE_SIZE_MB} MB'}), 413


# ─── Run ───
if __name__ == '__main__':
    log.info("🛡️  DeepGuard API starting…")
    log.info(f"   Upload dir : {UPLOAD_DIR}")
    log.info(f"   Max upload : {MAX_FILE_SIZE_MB} MB")
    app.run(host='0.0.0.0', port=5000, debug=True)
