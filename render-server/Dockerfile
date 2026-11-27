FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8765 \
    RENDER_OUTPUT_DIR=/data/outputs \
    PIPER_VOICES_DIR=/data/voices

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates git espeak-ng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir piper-tts==1.3.0

# Vozes femininas e masculinas nativas de português brasileiro (Apache-2.0).
RUN git init /opt/tiny-voca-ptbr-kokoro \
    && cd /opt/tiny-voca-ptbr-kokoro \
    && git remote add origin https://github.com/Haple/tiny-voca-ptbr-kokoro.git \
    && git fetch --depth 1 origin 1e7ed993260ecdd91552762f7403c00632bf5dab \
    && git checkout FETCH_HEAD \
    && mkdir -p model \
    && curl -fL --retry 3 --retry-delay 2 https://huggingface.co/Haple/tiny-voca-ptbr-kokoro/resolve/main/model/tiny-voca-ptbr.onnx -o model/tiny-voca-ptbr.onnx \
    && curl -fL --retry 3 --retry-delay 2 https://huggingface.co/Haple/tiny-voca-ptbr-kokoro/resolve/main/model/tiny-voca-ptbr.json -o model/tiny-voca-ptbr.json \
    && test -s model/tiny-voca-ptbr.onnx \
    && test -s model/tiny-voca-ptbr.json

ENV PYTHONPATH=/opt/tiny-voca-ptbr-kokoro

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
    && test -s /data/voices/pt_BR-faber-medium.onnx.json \
    && curl -fL --retry 3 --retry-delay 2 \
      https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/cadu/medium/pt_BR-cadu-medium.onnx \
      -o /data/voices/pt_BR-cadu-medium.onnx \
    && curl -fL --retry 3 --retry-delay 2 \
      https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/cadu/medium/pt_BR-cadu-medium.onnx.json \
      -o /data/voices/pt_BR-cadu-medium.onnx.json \
    && test -s /data/voices/pt_BR-cadu-medium.onnx \
    && test -s /data/voices/pt_BR-cadu-medium.onnx.json \
    && curl -fL --retry 3 --retry-delay 2 \
      https://huggingface.co/Lucasllfs/Razo-piper-voice/resolve/main/pt-BR-razo-medium.onnx \
      -o /data/voices/pt_BR-razo-medium.onnx \
    && curl -fL --retry 3 --retry-delay 2 \
      https://huggingface.co/Lucasllfs/Razo-piper-voice/resolve/main/config.json \
      -o /data/voices/pt_BR-razo-medium.onnx.json \
    && test -s /data/voices/pt_BR-razo-medium.onnx \
    && test -s /data/voices/pt_BR-razo-medium.onnx.json

COPY main.py image_engine.py video_engine.py story_engine.py agnes_video.py ./
RUN python -c "import main; print('Estúdio 2D render API import OK')" \
    && piper --help >/dev/null \
    && python -c "from tiny_voca_ptbr import Voice; import soundfile as sf; v=Voice(); [(lambda w: sf.write('/tmp/tiny-'+s+'.wav', w, v.sample_rate))(v.speak('Olá! Esta é uma amostra de voz em português brasileiro.', s)[0]) for s in ('F','M')]" \
    && test -s /tmp/tiny-F.wav \
    && test -s /tmp/tiny-M.wav \
    && printf "Teste de voz do Estudio 2D." | piper --model /data/voices/pt_BR-faber-medium.onnx --output_file /tmp/piper-smoke.wav \
    && test -s /tmp/piper-smoke.wav \
    && ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 /tmp/piper-smoke.wav | grep -Eq "^[0-9]+([.][0-9]+)?$" \
    && printf "Esta é uma segunda voz brasileira para testar a pronúncia." | piper --model /data/voices/pt_BR-cadu-medium.onnx --output_file /tmp/piper-cadu-smoke.wav \
    && test -s /tmp/piper-cadu-smoke.wav \
    && printf "Olá! Esta é a voz Razo, uma nova opção masculina brasileira." | piper --model /data/voices/pt_BR-razo-medium.onnx --output_file /tmp/piper-razo-smoke.wav \
    && test -s /tmp/piper-razo-smoke.wav \
    && rm -f /tmp/piper-smoke.wav /tmp/piper-cadu-smoke.wav /tmp/piper-razo-smoke.wav /tmp/tiny-F.wav /tmp/tiny-M.wav
RUN useradd --create-home --uid 10001 app \
    && chown -R app:app /app /data

USER app
EXPOSE 8765

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
