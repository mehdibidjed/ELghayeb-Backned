"""YOLOv8 ONNX inference (pose + COCO detection) with onnxruntime, no ultralytics needed.

Export the models once with:  yolo export model=yolov8n-pose.pt format=onnx
                               yolo export model=yolov8n.pt format=onnx
and drop the .onnx files into ai-service/models/.
"""

import threading
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

COCO_CELL_PHONE = 67


def letterbox(image: np.ndarray, size: int):
    h, w = image.shape[:2]
    scale = min(size / h, size / w)
    nh, nw = int(round(h * scale)), int(round(w * scale))
    resized = cv2.resize(image, (nw, nh), interpolation=cv2.INTER_LINEAR)
    top, left = (size - nh) // 2, (size - nw) // 2
    canvas = np.full((size, size, 3), 114, dtype=np.uint8)
    canvas[top : top + nh, left : left + nw] = resized
    blob = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    return blob.transpose(2, 0, 1)[None], scale, left, top


def _nms(boxes_xywh: np.ndarray, scores: np.ndarray, conf: float, iou: float = 0.5) -> np.ndarray:
    if len(boxes_xywh) == 0:
        return np.zeros(0, dtype=np.int64)
    xy = boxes_xywh.copy()
    xy[:, 0] -= xy[:, 2] / 2
    xy[:, 1] -= xy[:, 3] / 2
    keep = cv2.dnn.NMSBoxes(xy.tolist(), scores.tolist(), conf, iou)
    return np.asarray(keep, dtype=np.int64).reshape(-1)


class YoloModel:
    def __init__(self, path: Path, input_size: int):
        self.session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name
        self.size = input_size
        self.lock = threading.Lock()

    def _run(self, image):
        blob, scale, left, top = letterbox(image, self.size)
        with self.lock:
            out = self.session.run(None, {self.input_name: blob})[0][0]  # (C, N)
        return out.T, scale, left, top  # (N, C)

    @staticmethod
    def _unletterbox(xy: np.ndarray, scale, left, top):
        xy = xy.copy()
        xy[..., 0] = (xy[..., 0] - left) / scale
        xy[..., 1] = (xy[..., 1] - top) / scale
        return xy


class PoseModel(YoloModel):
    """yolov8n-pose: rows = cx, cy, w, h, conf, 17 × (x, y, visibility)."""

    def detect(self, image, conf: float):
        rows, scale, left, top = self._run(image)
        scores = rows[:, 4]
        mask = scores >= conf
        rows, scores = rows[mask], scores[mask]
        keep = _nms(rows[:, :4], scores, conf)
        persons = []
        for i in keep:
            cx, cy, w, h = rows[i, :4]
            box = self._unletterbox(np.array([[cx - w / 2, cy - h / 2], [cx + w / 2, cy + h / 2]]), scale, left, top)
            kps = rows[i, 5:].reshape(17, 3)
            kps[:, :2] = self._unletterbox(kps[:, :2], scale, left, top)
            persons.append({"box": box.reshape(-1), "score": float(scores[i]), "kps": kps})
        return persons


class DetectModel(YoloModel):
    """yolov8n: rows = cx, cy, w, h, 80 class scores."""

    def detect_class(self, image, class_id: int, conf: float):
        rows, scale, left, top = self._run(image)
        scores = rows[:, 4 + class_id]
        mask = scores >= conf
        rows, scores = rows[mask], scores[mask]
        keep = _nms(rows[:, :4], scores, conf)
        out = []
        for i in keep:
            cx, cy, w, h = rows[i, :4]
            box = self._unletterbox(np.array([[cx - w / 2, cy - h / 2], [cx + w / 2, cy + h / 2]]), scale, left, top)
            out.append({"box": box.reshape(-1), "score": float(scores[i])})
        return out
