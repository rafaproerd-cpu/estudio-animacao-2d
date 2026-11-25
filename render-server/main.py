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
MAX_CLIPS = int(os.getenv("MAX_CLIPS", "80"))
MAX_CLIP_BYTES = int(os.getenv("MAX_CLIP_BYTES", str(500 * 1024 * 1024)))
ALLOWED_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm"}

app = FastAPI(title="Estúdio 2D Render Server", version="1.0.0")


class RenderResponse(BaseModel):
    id: str
    filename: str
    download_url: str
    message: str


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


@app.get("/health")
def health() -> dict[str, str | bool]:
    return {"ok": True, "ffmpeg_available": shutil.which(FFMPEG) is not None, "token_configured": bool(API_TOKEN)}


@app.post("/render", response_model=RenderResponse)
async def render_video(
    clips: Annotated[list[UploadFile], File(description="Clipes ordenados na sequência desejada")],
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
                str(output_file),
            ])

        if not output_file.exists() or output_file.stat().st_size == 0:
            raise HTTPException(status_code=500, detail="O FFmpeg não produziu o MP4 final.")
        return RenderResponse(
            id=render_id,
            filename=f"{normalized_name}.mp4",
            download_url=f"/render/{render_id}",
            message="Vídeo montado. O áudio e a narração ainda precisam ser adicionados em uma etapa própria.",
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
