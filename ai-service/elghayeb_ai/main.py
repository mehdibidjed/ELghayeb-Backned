"""El Ghayeb AI service — HTTP wrapper around vision_model (model 1) and YOLO (model 2).

Stateless: embeddings come in with each request (from PostgreSQL via the
Node backend) and images are only held in memory for the call.
"""

import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool

from . import settings
from .behavior.engine import engine as behavior
from .face import decode_image, engine as face
from .matcher import recognise

log = logging.getLogger("elghayeb_ai")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    log.info("vision_model: %s", settings.VISION_MODEL_DIR)
    await run_in_threadpool(face.load)
    behavior.load()
    if not behavior.available:
        log.warning("behaviour model disabled: %s", behavior.error)
    yield


app = FastAPI(title="El Ghayeb AI service", version="0.1.0", lifespan=lifespan)


async def _read_image(upload: UploadFile):
    data = await upload.read()
    if len(data) > settings.MAX_IMAGE_BYTES:
        raise HTTPException(413, f"{upload.filename}: image too large")
    try:
        return decode_image(data)
    except ValueError as exc:
        raise HTTPException(400, f"{upload.filename}: {exc}") from exc


@app.get("/health")
def health():
    return {
        "status": "ok",
        "face": face.loaded,
        "behavior": behavior.available,
        "behavior_error": behavior.error,
        "thresholds": {
            "present": settings.PRESENT_THRESHOLD,
            "review": settings.REVIEW_THRESHOLD,
            "margin": settings.AMBIGUITY_MARGIN,
        },
    }


@app.post("/faces/embed")
async def embed(file: UploadFile = File(...)):
    """Enrolment photo → every detected face with its 512-d embedding."""
    image = await _read_image(file)
    faces = await run_in_threadpool(face.detect, image)
    return {
        "width": int(image.shape[1]),
        "height": int(image.shape[0]),
        "faces": [{**f, "embedding": f["embedding"].round(6).tolist()} for f in faces],
    }


@app.post("/attendance/recognize")
async def attendance(images: list[UploadFile] = File(...), payload: str = Form(...)):
    """
    images:  1..n JPEG photos of one scan (G, C, D)
    payload: {"students": [{"id": 1, "embeddings": [[512 floats], ...]}, ...]}
    """
    try:
        students = json.loads(payload).get("students", [])
    except json.JSONDecodeError as exc:
        raise HTTPException(400, "payload must be JSON") from exc
    if not images:
        raise HTTPException(400, "at least one image is required")

    decoded = [await _read_image(img) for img in images]
    faces_per_image = [await run_in_threadpool(face.detect, img) for img in decoded]
    return recognise(faces_per_image, students)


@app.post("/behavior/analyze")
async def analyze(file: UploadFile = File(...)):
    if not behavior.available:
        raise HTTPException(503, f"behaviour model unavailable: {behavior.error}")
    image = await _read_image(file)
    return await run_in_threadpool(behavior.analyse, image)
