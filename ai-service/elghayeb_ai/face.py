"""Model 1 — face detection + ArcFace embeddings, via vision_model's FaceRecognizer."""

import threading

import cv2
import numpy as np

from . import settings  # noqa: F401  (puts vision_model on sys.path)
from app.face_detector import FaceRecognizer  # vision_model/app/face_detector.py


class FaceEngine:
    def __init__(self):
        self._recognizer = None
        self._lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._recognizer is not None

    def load(self):
        # First call downloads buffalo_l (~280 MB) into ~/.insightface.
        with self._lock:
            if self._recognizer is None:
                self._recognizer = FaceRecognizer()

    def detect(self, image: np.ndarray) -> list[dict]:
        """Same output shape as FaceRecognizer.process_image, but from memory (no file)."""
        self.load()
        with self._lock:  # one inference at a time: the CPU is the bottleneck anyway
            faces = self._recognizer.model.get(image)
        return [
            {
                "face_id": i + 1,
                "bbox": [round(float(v), 1) for v in f.bbox.tolist()],
                "det_score": round(float(f.det_score), 4),
                "embedding": f.normed_embedding.astype(np.float32),
            }
            for i, f in enumerate(faces)
        ]


def decode_image(data: bytes) -> np.ndarray:
    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Image could not be decoded")
    return image


engine = FaceEngine()
