FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8765 \
    RENDER_OUTPUT_DIR=/data/outputs \
    PIPER_VOICES_DIR=/data/voices

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir piper-tts==1.3.0

# Instala uma voz masculina em português brasileiro por padrão.
# O modelo Faber medium é distribuído em ONNX pelo repositório Piper Voices.
RUN mkdir -p /data/outputs /data/voices \
    && curl -fL --retry 3 --retry-delay 2 \
      https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx \
      -o /data/voices/pt_BR-faber-medium.onnx \
    && curl -fL --retry 3 --retry-delay 2 \
      https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx.json \
      -o /data/voices/pt_BR-faber-medium.onnx.json \
    && test -s /data/voices/pt_BR-faber-medium.onnx \
    && test -s /data/voices/pt_BR-faber-medium.onnx.json

COPY main.py image_engine.py video_engine.py story_engine.py ./
RUN python -c "import main; print('Estúdio 2D render API import OK')" \
    && piper --help >/dev/null
RUN useradd --create-home --uid 10001 app \
    && chown -R app:app /app /data

USER app
EXPOSE 8765

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
