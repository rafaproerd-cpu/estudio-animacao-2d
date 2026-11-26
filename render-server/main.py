from __future__ import annotations

import base64
import binascii
import os
import re
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import BackgroundTasks, FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field

from image_engine import IMAGE_OUTPUT_DIR, generate_sdxl_image, image_engine_status
from video_engine import WAN_OUTPUT_DIR, generate_wan_video, video_engine_status

APP_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = Path(os.getenv("RENDER_OUTPUT_DIR", str(APP_DIR / "outputs"))).resolve()
API_TOKEN = os.getenv("ESTUDIO_RENDER_TOKEN", "").strip()
FFMPEG = os.getenv("FFMPEG_PATH", "ffmpeg")
PIPER = os.getenv("PIPER_PATH", "piper")
PIPER_VOICES_DIR = Path(os.getenv("PIPER_VOICES_DIR", str(APP_DIR / "voices"))).resolve()
MAX_TTS_CHARACTERS = int(os.getenv("MAX_TTS_CHARACTERS", "6000"))
MAX_CLIPS = int(os.getenv("MAX_CLIPS", "80"))
MAX_CLIP_BYTES = int(os.getenv("MAX_CLIP_BYTES", str(500 * 1024 * 1024)))
ALLOWED_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm"}
ALLOWED_AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}

app = FastAPI(title="Estúdio 2D Render Server", version="1.1.0")

generation_jobs: dict[str, dict[str, object]] = {}
generation_jobs_lock = threading.Lock()
generation_download_tokens: dict[str, tuple[str, float]] = {}
MAX_ACTIVE_IMAGE_JOBS = max(1, int(os.getenv("MAX_ACTIVE_IMAGE_JOBS", "1")))
JOB_RETENTION_SECONDS = max(3600, int(os.getenv("JOB_RETENTION_SECONDS", "86400")))


def prune_generation_state() -> None:
    now = time.time()
    with generation_jobs_lock:
        expired_jobs = [
            job_id for job_id, job in generation_jobs.items()
            if job.get("status") in {"completed", "failed", "cancelled"}
            and now - float(job.get("created_at", now)) > JOB_RETENTION_SECONDS
        ]
        for job_id in expired_jobs:
            generation_jobs.pop(job_id, None)
        expired_tokens = [name for name, grant in generation_download_tokens.items() if grant[1] < now]
        for name in expired_tokens:
            generation_download_tokens.pop(name, None)


class ImageGenerationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    prompt: str = Field(min_length=1, max_length=12000)
    negative_prompt: str | None = Field(default=None, alias="negativePrompt", max_length=4000)
    width: int = Field(default=1024, ge=512, le=1024)
    height: int = Field(default=576, ge=512, le=1024)
    seed: int | None = None
    reference_image_uris: list[str] = Field(default_factory=list, alias="referenceImageUris")


def run_image_generation_job(job_id: str, payload: ImageGenerationRequest) -> None:
    with generation_jobs_lock:
        generation_jobs[job_id].update({"status": "running", "message": "Carregando o motor de imagem e gerando a cena."})
    try:
        output = generate_sdxl_image(
            prompt=payload.prompt.strip(),
            negative_prompt=payload.negative_prompt,
            width=payload.width,
            height=payload.height,
            seed=payload.seed,
        )
        download_token = secrets.token_urlsafe(32)
        with generation_jobs_lock:
            generation_download_tokens[output.name] = (download_token, time.time() + 3600)
            generation_jobs[job_id].update({
                "status": "completed",
                "progress": 1.0,
                "message": "Imagem gerada.",
                "output_url": "/v1/files/" + output.name + "?token=" + download_token,
            })
    except Exception as error:
        with generation_jobs_lock:
            generation_jobs[job_id].update({
                "status": "failed",
                "progress": 0.0,
                "message": "A geração de imagem falhou.",
                "error": str(error)[:1200],
            })


class VideoGenerationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    prompt: str = Field(min_length=1, max_length=12000)
    image_base64: str = Field(alias="imageBase64", min_length=100, max_length=24_000_000)
    duration_seconds: float = Field(default=4.0, alias="durationSeconds", ge=1.0, le=5.0)
    seed: int | None = None


def run_video_generation_job(job_id: str, payload: VideoGenerationRequest, image_bytes: bytes) -> None:
    with generation_jobs_lock:
        generation_jobs[job_id].update({"status": "running", "message": "Preparando imagem de referência e gerando o clipe com Wan2.2."})
    try:
        output = generate_wan_video(
            prompt=payload.prompt.strip(),
            image_bytes=image_bytes,
            duration_seconds=payload.duration_seconds,
            seed=payload.seed,
        )
        download_token = secrets.token_urlsafe(32)
        with generation_jobs_lock:
            generation_download_tokens[output.name] = (download_token, time.time() + 3600)
            generation_jobs[job_id].update({
                "status": "completed",
                "progress": 1.0,
                "message": "Clipe de vídeo gerado.",
                "output_url": "/v1/files/" + output.name + "?token=" + download_token,
            })
    except Exception as error:
        with generation_jobs_lock:
            generation_jobs[job_id].update({
                "status": "failed",
                "progress": 0.0,
                "message": "A geração de vídeo falhou.",
                "error": str(error)[:1600],
            })


class RenderResponse(BaseModel):
    id: str
    filename: str
    download_url: str
    message: str


class TTSRequest(BaseModel):
    text: str
    voice: str
    duration_seconds: float = 4.0


class TTSResponse(BaseModel):
    id: str
    download_url: str
    voice: str


class TTSBatchRequest(BaseModel):
    segments: list[TTSRequest]


def require_token(authorization: str | None) -> None:
    if not API_TOKEN:
        raise HTTPException(status_code=503, detail="Configure ESTUDIO_RENDER_TOKEN antes de iniciar o servidor.")
    supplied = authorization or ""
    expected = f"Bearer {API_TOKEN}"
    if not secrets.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Token de renderização inválido.")


def safe_extension(filename: str | None) -> str:
    extension = Path(filename or "").suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail=f"Formato não aceito: {extension or 'sem extensão'}. Use MP4, MOV, MKV ou WebM.")
    return extension


def safe_audio_extension(filename: str | None) -> str:
    extension = Path(filename or "").suffix.lower()
    if extension not in ALLOWED_AUDIO_EXTENSIONS:
        raise HTTPException(status_code=415, detail=f"Áudio não aceito: {extension or 'sem extensão'}. Use MP3, WAV, M4A, AAC, OGG ou FLAC.")
    return extension


async def save_audio_upload(upload: UploadFile | None, target: Path) -> Path | None:
    if upload is None:
        return None
    safe_audio_extension(upload.filename)
    total = 0
    with target.open("wb") as output:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_CLIP_BYTES:
                raise HTTPException(status_code=413, detail="O arquivo de áudio excede o limite de 500 MB.")
            output.write(chunk)
    await upload.close()
    if total == 0:
        raise HTTPException(status_code=400, detail="O arquivo de áudio está vazio.")
    return target


def run_ffmpeg(arguments: list[str]) -> None:
    try:
        result = subprocess.run(
            [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", *arguments],
            capture_output=True,
            text=True,
            timeout=60 * 60,
            check=False,
        )
    except FileNotFoundError as error:
        raise HTTPException(status_code=503, detail="FFmpeg não encontrado. Instale FFmpeg e adicione-o ao PATH.") from error
    except subprocess.TimeoutExpired as error:
        raise HTTPException(status_code=504, detail="A montagem excedeu o limite de uma hora.") from error
    if result.returncode != 0:
        detail = (result.stderr or "Falha desconhecida no FFmpeg")[-1800:]
        raise HTTPException(status_code=422, detail=f"FFmpeg não conseguiu montar os clipes: {detail}")


@app.get("/v1/capabilities")
def generation_capabilities(authorization: Annotated[str | None, Header()] = None) -> dict[str, object]:
    """Informa recursos realmente instalados; não anuncia motores fictícios."""
    require_token(authorization)
    piper_available = shutil.which(PIPER) is not None
    voices = available_piper_voices()
    gpus = available_nvidia_gpus()
    return {
        "product": "Estúdio 2D",
        "api_version": "v1",
        "hardware": {
            "nvidia_gpus": gpus,
            "gpu_detection": "available" if gpus else "not_detected",
            "note": "A detecção NVIDIA não confirma compatibilidade com um modelo; requisitos de VRAM e CUDA ainda precisam ser validados.",
        },
        "engines": {
            "image": image_engine_status(),
            "video": {
                "available": False,
                "status": "not_configured",
                "message": "Nenhum modelo de animação de vídeo foi instalado neste servidor.",
            },
            "audio": {
                "available": piper_available and bool(voices),
                "status": "ready" if piper_available and voices else "not_configured",
                "engine": "Piper local",
                "voices": voices,
                "message": "Voz local disponível." if piper_available and voices else "Instale o Piper e ao menos um modelo .onnx para ativar a voz.",
            },
            "render": {
                "available": shutil.which(FFMPEG) is not None,
                "status": "ready" if shutil.which(FFMPEG) is not None else "not_configured",
            },
        },
    }


@app.post("/v1/generations/images")
def request_image_generation(
    payload: ImageGenerationRequest,
    background_tasks: BackgroundTasks,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    """Enfileira SDXL somente quando modelo, dependências e dispositivo estão prontos."""
    require_token(authorization)
    status = image_engine_status()
    if not status["available"]:
        raise HTTPException(status_code=503, detail=str(status["message"]) + " Consulte /v1/capabilities.")
    if not payload.prompt.strip():
        raise HTTPException(status_code=400, detail="Informe um prompt de imagem.")
    if payload.width % 8 or payload.height % 8:
        raise HTTPException(status_code=400, detail="Largura e altura precisam ser múltiplos de 8.")
    if payload.reference_image_uris:
        raise HTTPException(status_code=422, detail="Este primeiro motor SDXL aceita texto para imagem. Referências de personagem serão ativadas na etapa image-to-image.")
    prune_generation_state()
    job_id = uuid.uuid4().hex
    with generation_jobs_lock:
        active_jobs = sum(1 for job in generation_jobs.values() if job.get("status") in {"queued", "running"})
        if active_jobs >= MAX_ACTIVE_IMAGE_JOBS:
            raise HTTPException(status_code=429, detail="O motor de imagem já está ocupado. Aguarde a tarefa atual terminar.")
        generation_jobs[job_id] = {
            "status": "queued",
            "progress": 0.0,
            "message": "Aguardando o motor de imagem.",
            "created_at": time.time(),
        }
    background_tasks.add_task(run_image_generation_job, job_id, payload)
    return {"job_id": job_id, "status": "queued", "progress": 0.0, "message": "Geração adicionada à fila."}


@app.get("/v1/jobs/{job_id}")
def get_generation_job(job_id: str, authorization: Annotated[str | None, Header()] = None) -> dict[str, object]:
    require_token(authorization)
    if not re.fullmatch(r"[a-f0-9]{32}", job_id):
        raise HTTPException(status_code=404, detail="Tarefa não encontrada.")
    prune_generation_state()
    with generation_jobs_lock:
        job = generation_jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Tarefa não encontrada ou servidor reiniciado.")
        return {"job_id": job_id, **job}


@app.get("/v1/files/{filename}")
def download_generated_media(
    filename: str,
    token: Annotated[str | None, Query()] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> FileResponse:
    if not re.fullmatch(r"(?:image-[a-f0-9]{32}\.png|video-[a-f0-9]{32}\.mp4)", filename):
        raise HTTPException(status_code=404, detail="Arquivo gerado não encontrado.")
    if authorization:
        require_token(authorization)
    else:
        with generation_jobs_lock:
            grant = generation_download_tokens.get(filename)
        if not token or not grant or grant[1] < time.time() or not secrets.compare_digest(token, grant[0]):
            raise HTTPException(status_code=401, detail="Link de arquivo inválido ou expirado.")
    media_dir = WAN_OUTPUT_DIR if filename.startswith("video-") else IMAGE_OUTPUT_DIR
    media_path = media_dir / filename
    if not media_path.is_file():
        raise HTTPException(status_code=404, detail="Arquivo gerado não encontrado ou já removido.")
    media_type = "video/mp4" if filename.startswith("video-") else "image/png"
    return FileResponse(media_path, media_type=media_type, filename=filename)


@app.post("/v1/generations/videos")
def request_video_generation(
    payload: VideoGenerationRequest,
    background_tasks: BackgroundTasks,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    """Enfileira Wan2.2 TI2V somente quando runtime, pesos e GPU estão prontos."""
    require_token(authorization)
    status = video_engine_status()
    if not status["available"]:
        raise HTTPException(status_code=503, detail=str(status["message"]) + " Consulte /v1/capabilities.")
    if not payload.prompt.strip():
        raise HTTPException(status_code=400, detail="Informe um prompt de animação.")
    encoded = payload.image_base64
    if encoded.startswith("data:") and "," in encoded:
        encoded = encoded.split(",", 1)[1]
    try:
        image_bytes = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise HTTPException(status_code=400, detail="A imagem de referência não está em Base64 válido.") from error
    if not image_bytes or len(image_bytes) > 18 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="A imagem de referência deve ter até 18 MB.")
    if not (image_bytes.startswith(b"\\x89PNG\\r\\n\\x1a\\n") or image_bytes.startswith(b"\\xff\\xd8\\xff")):
        raise HTTPException(status_code=415, detail="Envie uma imagem PNG ou JPEG válida.")
    prune_generation_state()
    job_id = uuid.uuid4().hex
    with generation_jobs_lock:
        active_jobs = sum(1 for job in generation_jobs.values() if job.get("status") in {"queued", "running"})
        if active_jobs >= MAX_ACTIVE_IMAGE_JOBS:
            raise HTTPException(status_code=429, detail="O motor de mídia já está ocupado. Aguarde a tarefa atual terminar.")
        generation_jobs[job_id] = {
            "status": "queued",
            "progress": 0.0,
            "message": "Aguardando o motor de vídeo.",
            "created_at": time.time(),
        }
    background_tasks.add_task(run_video_generation_job, job_id, payload, image_bytes)
    return {"job_id": job_id, "status": "queued", "progress": 0.0, "message": "Animação adicionada à fila."}


@app.get("/health")
def health(authorization: Annotated[str | None, Header()] = None) -> dict[str, str | bool]:
    require_token(authorization)
    return {"ok": True, "ffmpeg_available": shutil.which(FFMPEG) is not None, "token_configured": True}


def available_nvidia_gpus() -> list[dict[str, str]]:
    """Detecta GPUs NVIDIA e métricas reportadas pelo driver, sem exigir CUDA."""
    executable = shutil.which("nvidia-smi")
    if not executable:
        return []
    try:
        result = subprocess.run(
            [
                executable,
                "--query-gpu=name,memory.total,memory.free,driver_version",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    if result.returncode != 0:
        return []
    gpus: list[dict[str, str]] = []
    for line in result.stdout.splitlines():
        parts = [part.strip() for part in line.split(",", maxsplit=3)]
        if len(parts) == 4 and parts[0]:
            gpus.append({
                "name": parts[0],
                "memory_total_mb": parts[1],
                "memory_free_mb": parts[2],
                "driver_version": parts[3],
            })
    return gpus


def available_piper_voices() -> list[str]:
    if not PIPER_VOICES_DIR.is_dir():
        return []
    return sorted(path.stem for path in PIPER_VOICES_DIR.glob("*.onnx") if path.is_file())


@app.get("/tts/voices")
def list_tts_voices(authorization: Annotated[str | None, Header()] = None) -> dict[str, list[str]]:
    require_token(authorization)
    return {"voices": available_piper_voices(), "engine": "Piper local"}


@app.post("/tts")
def generate_tts(payload: TTSRequest, authorization: Annotated[str | None, Header()] = None) -> TTSResponse:
    require_token(authorization)
    text = payload.text.strip()
    voice = payload.voice.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Informe o texto que será narrado.")
    if len(text) > MAX_TTS_CHARACTERS:
        raise HTTPException(status_code=413, detail=f"O texto excede o limite de {MAX_TTS_CHARACTERS} caracteres.")
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", voice):
        raise HTTPException(status_code=400, detail="Identificador de voz inválido.")
    model = (PIPER_VOICES_DIR / (voice + ".onnx")).resolve()
    if model.parent != PIPER_VOICES_DIR or not model.is_file():
        raise HTTPException(status_code=404, detail="Voz não encontrada. Adicione o modelo Piper correspondente à pasta de vozes.")
    executable = shutil.which(PIPER)
    if not executable:
        raise HTTPException(status_code=503, detail="O motor Piper não está instalado neste servidor.")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    tts_id = uuid.uuid4().hex
    output_file = OUTPUT_DIR / ("tts-" + tts_id + ".wav")
    try:
        result = subprocess.run(
            [executable, "--model", str(model), "--output_file", str(output_file)],
            input=text, capture_output=True, text=True, timeout=180, check=False,
        )
    except subprocess.TimeoutExpired as error:
        output_file.unlink(missing_ok=True)
        raise HTTPException(status_code=504, detail="A geração de voz excedeu três minutos.") from error
    if result.returncode != 0 or not output_file.is_file() or output_file.stat().st_size == 0:
        output_file.unlink(missing_ok=True)
        detail = (result.stderr or "Falha desconhecida no Piper")[-1200:]
        raise HTTPException(status_code=422, detail="Não foi possível gerar a voz: " + detail)
    return TTSResponse(id=tts_id, download_url="/tts/" + tts_id, voice=voice)


@app.post("/tts/batch")
def generate_tts_batch(payload: TTSBatchRequest, authorization: Annotated[str | None, Header()] = None) -> TTSResponse:
    require_token(authorization)
    if not payload.segments or len(payload.segments) > MAX_CLIPS:
        raise HTTPException(status_code=400, detail=f"Envie entre 1 e {MAX_CLIPS} falas.")
    for segment in payload.segments:
        if not 0.5 <= segment.duration_seconds <= 60:
            raise HTTPException(status_code=400, detail="A duração de cada cena deve ficar entre 0,5 e 60 segundos.")
        if len(segment.text) > MAX_TTS_CHARACTERS:
            raise HTTPException(status_code=413, detail="Uma das falas excede o limite de caracteres.")
        if segment.text.strip():
            if not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", segment.voice.strip()):
                raise HTTPException(status_code=400, detail="Identificador de voz inválido.")
            model = (PIPER_VOICES_DIR / (segment.voice.strip() + ".onnx")).resolve()
            if model.parent != PIPER_VOICES_DIR or not model.is_file():
                raise HTTPException(status_code=404, detail="Modelo de voz não encontrado: " + segment.voice)
    executable = shutil.which(PIPER)
    if not executable:
        raise HTTPException(status_code=503, detail="O motor Piper não está instalado neste servidor.")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    batch_id = uuid.uuid4().hex
    temporary_dir = Path(tempfile.mkdtemp(prefix="tts-batch-", dir=OUTPUT_DIR))
    try:
        segment_files: list[Path] = []
        for index, segment in enumerate(payload.segments):
            audio_file = temporary_dir / ("segment-" + str(index).zfill(3) + ".wav")
            if segment.text.strip():
                model = PIPER_VOICES_DIR / (segment.voice.strip() + ".onnx")
                result = subprocess.run([executable, "--model", str(model), "--output_file", str(audio_file)], input=segment.text.strip(), capture_output=True, text=True, timeout=180, check=False)
                if result.returncode != 0 or not audio_file.is_file() or audio_file.stat().st_size == 0:
                    detail = (result.stderr or "Falha desconhecida no Piper")[-1200:]
                    raise HTTPException(status_code=422, detail="Falha ao gerar fala " + str(index + 1) + ": " + detail)
                try:
                    import wave
                    with wave.open(str(audio_file), "rb") as wav_file:
                        speech_duration = wav_file.getnframes() / float(wav_file.getframerate())
                except (wave.Error, OSError, ZeroDivisionError, EOFError):
                    speech_duration = segment.duration_seconds
                if speech_duration > segment.duration_seconds * 2.0:
                    raise HTTPException(status_code=422, detail="A fala " + str(index + 1) + " é longa demais para a duração desta cena. Encurte o diálogo.")
                tempo = min(2.0, max(1.0, speech_duration / segment.duration_seconds))
                audio_filter = f"aresample=22050,atempo={tempo:.4f},apad,atrim=duration={segment.duration_seconds:.3f},aformat=sample_fmts=s16:channel_layouts=mono"
                fitted_file = temporary_dir / ("fitted-" + str(index).zfill(3) + ".wav")
                run_ffmpeg(["-i", str(audio_file), "-af", audio_filter, "-ar", "22050", "-ac", "1", str(fitted_file)])
            else:
                fitted_file = temporary_dir / ("silence-" + str(index).zfill(3) + ".wav")
                run_ffmpeg(["-f", "lavfi", "-i", "anullsrc=r=22050:cl=mono", "-t", f"{segment.duration_seconds:.3f}", "-c:a", "pcm_s16le", str(fitted_file)])
            segment_files.append(fitted_file)
        output_file = OUTPUT_DIR / ("tts-" + batch_id + ".wav")
        concat_list = temporary_dir / "audio-segments.txt"
        concat_list.write_text("".join("file '" + path.as_posix() + "'\n" for path in segment_files), encoding="utf-8")
        run_ffmpeg(["-f", "concat", "-safe", "0", "-i", str(concat_list), "-c:a", "pcm_s16le", str(output_file)])
        return TTSResponse(id=batch_id, download_url="/tts/" + batch_id, voice="multiple")
    finally:
        shutil.rmtree(temporary_dir, ignore_errors=True)

@app.get("/tts/{tts_id}")
def download_tts(tts_id: str, authorization: Annotated[str | None, Header()] = None) -> FileResponse:
    require_token(authorization)
    if not re.fullmatch(r"[a-f0-9]{32}", tts_id):
        raise HTTPException(status_code=404, detail="Áudio não encontrado.")
    audio_file = OUTPUT_DIR / ("tts-" + tts_id + ".wav")
    if not audio_file.is_file():
        raise HTTPException(status_code=404, detail="Áudio não encontrado ou já removido.")
    return FileResponse(audio_file, media_type="audio/wav", filename="narracao-" + tts_id + ".wav")


@app.post("/render", response_model=RenderResponse)
async def render_video(
    clips: Annotated[list[UploadFile], File(description="Clipes ordenados na sequência desejada")],
    narration: Annotated[UploadFile | None, File(description="Narração opcional")] = None,
    music: Annotated[UploadFile | None, File(description="Música de fundo opcional")] = None,
    project_name: Annotated[str, Form()] = "Estudio-2D",
    authorization: Annotated[str | None, Header()] = None,
) -> RenderResponse:
    require_token(authorization)
    if not clips:
        raise HTTPException(status_code=400, detail="Envie pelo menos um clipe.")
    if len(clips) > MAX_CLIPS:
        raise HTTPException(status_code=413, detail=f"Limite de {MAX_CLIPS} clipes por montagem.")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    render_id = uuid.uuid4().hex
    output_file = OUTPUT_DIR / f"{render_id}.mp4"
    normalized_name = re.sub(r"[^a-zA-Z0-9_-]+", "-", project_name).strip("-_")[:48] or "Estudio-2D"

    try:
        with tempfile.TemporaryDirectory(prefix="estudio2d-") as temp_dir:
            temp_path = Path(temp_dir)
            normalized_files: list[Path] = []

            for index, upload in enumerate(clips):
                extension = safe_extension(upload.filename)
                source = temp_path / f"source-{index:03d}{extension}"
                total = 0
                with source.open("wb") as target:
                    while True:
                        chunk = await upload.read(1024 * 1024)
                        if not chunk:
                            break
                        total += len(chunk)
                        if total > MAX_CLIP_BYTES:
                            raise HTTPException(status_code=413, detail=f"O clipe {index + 1} excede o limite de 500 MB.")
                        target.write(chunk)
                await upload.close()
                if total == 0:
                    raise HTTPException(status_code=400, detail=f"O clipe {index + 1} está vazio.")

                normalized = temp_path / f"normalized-{index:03d}.mp4"
                run_ffmpeg([
                    "-i", str(source),
                    "-map", "0:v:0",
                    "-vf", "scale=1024:576:force_original_aspect_ratio=decrease,pad=1024:576:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p",
                    "-an",
                    "-c:v", "libx264",
                    "-preset", "veryfast",
                    "-crf", "20",
                    "-movflags", "+faststart",
                    str(normalized),
                ])
                normalized_files.append(normalized)

            narration_path = await save_audio_upload(narration, temp_path / f"narration{safe_audio_extension(narration.filename)}") if narration else None
            music_path = await save_audio_upload(music, temp_path / f"music{safe_audio_extension(music.filename)}") if music else None

            concat_list = temp_path / "clips.txt"
            concat_list.write_text(
                "".join(f"file '{path.as_posix()}'\n" for path in normalized_files),
                encoding="utf-8",
            )
            run_ffmpeg([
                "-f", "concat",
                "-safe", "0",
                "-i", str(concat_list),
                "-c", "copy",
                "-movflags", "+faststart",
                str(temp_path / "joined-video.mp4"),
            ])

            joined_video = temp_path / "joined-video.mp4"
            if narration_path or music_path:
                audio_inputs = ["-i", str(joined_video)]
                if narration_path:
                    audio_inputs.extend(["-i", str(narration_path)])
                if music_path:
                    audio_inputs.extend(["-i", str(music_path)])

                if narration_path and music_path:
                    audio_filter = "[1:a]volume=1.0[narr];[2:a]volume=0.18[music];[narr][music]amix=inputs=2:duration=longest:dropout_transition=2,apad[aout]"
                elif narration_path:
                    audio_filter = "[1:a]volume=1.0,apad[aout]"
                else:
                    audio_filter = "[1:a]volume=0.18,apad[aout]"

                run_ffmpeg([
                    *audio_inputs,
                    "-filter_complex", audio_filter,
                    "-map", "0:v:0",
                    "-map", "[aout]",
                    "-c:v", "copy",
                    "-c:a", "aac",
                    "-b:a", "192k",
                    "-shortest",
                    "-movflags", "+faststart",
                    str(output_file),
                ])
            else:
                shutil.copy2(joined_video, output_file)

        if not output_file.exists() or output_file.stat().st_size == 0:
            raise HTTPException(status_code=500, detail="O FFmpeg não produziu o MP4 final.")
        return RenderResponse(
            id=render_id,
            filename=f"{normalized_name}.mp4",
            download_url=f"/render/{render_id}",
            message="Vídeo montado com as cenas" + (" e áudio mixado." if narration_path or music_path else ". Você pode adicionar narração e música na montagem."),
        )
    except Exception:
        output_file.unlink(missing_ok=True)
        raise


@app.get("/render/{render_id}")
def download_render(render_id: str, authorization: Annotated[str | None, Header()] = None) -> FileResponse:
    require_token(authorization)
    if not re.fullmatch(r"[a-f0-9]{32}", render_id):
        raise HTTPException(status_code=404, detail="Vídeo não encontrado.")
    output_file = OUTPUT_DIR / f"{render_id}.mp4"
    if not output_file.is_file():
        raise HTTPException(status_code=404, detail="Vídeo não encontrado ou já removido.")
    return FileResponse(output_file, media_type="video/mp4", filename=f"estudio-2d-{render_id}.mp4")
