from __future__ import annotations

import os
import re
import secrets
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

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

app = FastAPI(title="Estúdio 2D Render Server", version="1.0.0")


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
    return {
        "product": "Estúdio 2D",
        "api_version": "v1",
        "engines": {
            "image": {
                "available": False,
                "status": "not_configured",
                "message": "Nenhum modelo de imagem foi instalado neste servidor.",
            },
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
def request_image_generation(authorization: Annotated[str | None, Header()] = None) -> None:
    """Falha explicitamente até um modelo de imagem real ser instalado."""
    require_token(authorization)
    raise HTTPException(
        status_code=503,
        detail="A geração de imagens ainda não está configurada neste servidor. Consulte /v1/capabilities.",
    )


@app.post("/v1/generations/videos")
def request_video_generation(authorization: Annotated[str | None, Header()] = None) -> None:
    """Falha explicitamente até um modelo de vídeo real ser instalado."""
    require_token(authorization)
    raise HTTPException(
        status_code=503,
        detail="A geração de animações ainda não está configurada neste servidor. Consulte /v1/capabilities.",
    )


@app.get("/health")
def health(authorization: Annotated[str | None, Header()] = None) -> dict[str, str | bool]:
    require_token(authorization)
    return {"ok": True, "ffmpeg_available": shutil.which(FFMPEG) is not None, "token_configured": True}


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
