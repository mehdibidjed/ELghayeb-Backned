"""AI service settings (environment variables)."""

import os
import sys
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parent.parent

# The face model code is the team's prototype in ../vision_model; we import it
# as-is instead of copying it.
VISION_MODEL_DIR = Path(
    os.environ.get("VISION_MODEL_DIR", SERVICE_DIR.parent.parent / "vision_model")
).resolve()

if not (VISION_MODEL_DIR / "app" / "face_detector.py").exists():
    raise RuntimeError(
        f"vision_model not found at {VISION_MODEL_DIR}. Set VISION_MODEL_DIR."
    )
if str(VISION_MODEL_DIR) not in sys.path:
    sys.path.insert(0, str(VISION_MODEL_DIR))

from app import config as vm_config  # noqa: E402  (vision_model/app/config.py)

# Model 1 thresholds. "present" comes from vision_model; the spec adds a
# review band: 0.35 <= score < 0.45 → "à vérifier".
PRESENT_THRESHOLD = float(os.environ.get("PRESENT_THRESHOLD", vm_config.RECOGNITION_THRESHOLD))
REVIEW_THRESHOLD = float(os.environ.get("REVIEW_THRESHOLD", 0.35))
AMBIGUITY_MARGIN = float(os.environ.get("AMBIGUITY_MARGIN", vm_config.AMBIGUITY_MARGIN))

# Model 2 (behaviour) ONNX files — optional.
BEHAVIOR_MODELS_DIR = Path(os.environ.get("BEHAVIOR_MODELS_DIR", SERVICE_DIR / "models"))
POSE_MODEL = BEHAVIOR_MODELS_DIR / os.environ.get("POSE_MODEL_FILE", "yolov8n-pose.onnx")
DETECT_MODEL = BEHAVIOR_MODELS_DIR / os.environ.get("DETECT_MODEL_FILE", "yolov8n.onnx")
YOLO_INPUT_SIZE = int(os.environ.get("YOLO_INPUT_SIZE", 640))
POSE_CONFIDENCE = float(os.environ.get("POSE_CONFIDENCE", 0.35))
PHONE_CONFIDENCE = float(os.environ.get("PHONE_CONFIDENCE", 0.30))

MAX_IMAGE_BYTES = int(os.environ.get("MAX_IMAGE_BYTES", 10 * 1024 * 1024))
