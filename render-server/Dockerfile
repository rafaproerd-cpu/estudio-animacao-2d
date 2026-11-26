FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8765 \
    RENDER_OUTPUT_DIR=/data/outputs \
    PIPER_VOICES_DIR=/data/voices

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py image_engine.py ./
RUN useradd --create-home --uid 10001 app \
    && mkdir -p /data/outputs /data/voices \
    && chown -R app:app /app /data

USER app
EXPOSE 8765

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
