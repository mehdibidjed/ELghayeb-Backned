FROM python:3.12-slim

# insightface builds a small C++ extension; libgl/glib for OpenCV.
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /service
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY elghayeb_ai ./elghayeb_ai
COPY models ./models

# vision_model is mounted here by docker-compose (../vision_model).
ENV VISION_MODEL_DIR=/vision_model
EXPOSE 8000
CMD ["uvicorn", "elghayeb_ai.main:app", "--host", "0.0.0.0", "--port", "8000"]
