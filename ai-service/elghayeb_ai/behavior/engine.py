from .. import settings
from .rules import summarise
from .yolo import COCO_CELL_PHONE, DetectModel, PoseModel


class BehaviorEngine:
    """Model 2. Optional: available only if the YOLO .onnx files are present."""

    def __init__(self):
        self.pose = None
        self.detect = None
        self.error = None

    def load(self):
        missing = [p.name for p in (settings.POSE_MODEL, settings.DETECT_MODEL) if not p.exists()]
        if missing:
            self.error = f"missing model files in {settings.BEHAVIOR_MODELS_DIR}: {', '.join(missing)}"
            return
        try:
            self.pose = PoseModel(settings.POSE_MODEL, settings.YOLO_INPUT_SIZE)
            self.detect = DetectModel(settings.DETECT_MODEL, settings.YOLO_INPUT_SIZE)
        except Exception as exc:  # corrupt / incompatible export
            self.pose = self.detect = None
            self.error = f"failed to load behaviour models: {exc}"

    @property
    def available(self) -> bool:
        return self.pose is not None and self.detect is not None

    def analyse(self, image) -> dict:
        persons = self.pose.detect(image, settings.POSE_CONFIDENCE)
        phones = self.detect.detect_class(image, COCO_CELL_PHONE, settings.PHONE_CONFIDENCE)
        return summarise(persons, phones)


engine = BehaviorEngine()
