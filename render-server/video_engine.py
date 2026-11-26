from __future__ import annotations

import math
import os
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

WAN_GENERATE_SCRIPT = Path(os.getenv("WAN_GENERATE_SCRIPT", "")).expanduser()
WAN_CHECKPOINT_DIR = Path(os.getenv("WAN_CHECKPOINT_DIR", "")).expanduser()
WAN_PYTHON = os.getenv("WAN_PYTHON", sys.executable)
WAN_SIZE = os.getenv("WAN_SIZE", "1280*704")
WAN_MIN_FREE_VRAM_MB = max(22000, int(os.getenv("WAN_MIN_FREE_VRAM_MB", "23000")))
WAN_TIMEOUT_SECONDS = max(600, int(os.getenv("WAN_TIMEOUT_SECONDS", "10800")))
FFMPEG = os.getenv("FFMPEG_PATH", "ffmpeg")
WAN_OUTPUT_DIR = Path(os.getenv("IMAGE_OUTPUT_DIR", os.getenv("RENDER_OUTPUT_DIR", "outputs"))).resolve()


def _wan_status() -> dict[str, object]:
    if not WAN_GENERATE_SCRIPT.is_file():
        return {"available": False, "status": "wan_runtime_missing", "message": "Runtime Wan2.2 não configurado."}
    if not os.getenv("WAN_CHECKPOINT_DIR", "").strip() or not WAN_CHECKPOINT_DIR.is_dir():
        return {"available": False, "status": "wan_model_missing", "message": "Pesos Wan2.2 não configurados."}
    if not (shutil.which(WAN_PYTHON) or Path(WAN_PYTHON).is_file()):
        return {"available": False, "status": "python_missing", "message": "Executável Python do Wan2.2 não encontrado."}
    try:
        import torch
        if not torch.cuda.is_available():
            return {"available": False, "status": "gpu_unavailable", "message": "Wan2.2 precisa de uma GPU CUDA compatível."}
        free_bytes, total_bytes = torch.cuda.mem_get_info()
        free_mb = int(free_bytes / (1024 * 1024))
        total_mb = int(total_bytes / (1024 * 1024))
    except Exception:
        return {"available": False, "status": "gpu_diagnostics_failed", "message": "Não foi possível validar PyTorch, CUDA e memória livre da GPU."}
    if free_mb < WAN_MIN_FREE_VRAM_MB:
        return {
            "available": False,
            "status": "insufficient_vram",
            "vram_free_mb": free_mb,
            "vram_total_mb": total_mb,
            "message": f"Wan2.2 requer aproximadamente 24 GB livres. Disponível: {free_mb} MB.",
        }
    return {
        "available": True,
        "status": "ready",
        "model": "Wan2.2 TI2V 5B",
        "device": "cuda",
        "vram_free_mb": free_mb,
        "vram_total_mb": total_mb,
        "message": "Wan2.2 pronto; uma execução real ainda precisa ser validada.",
    }


def video_engine_status() -> dict[str, object]:
    wan = _wan_status()
    if wan["available"]:
        return wan
    if shutil.which(FFMPEG):
        return {
            "available": True,
            "status": "ready_motion_only",
            "model": "FFmpeg Ken Burns",
            "device": "cpu",
            "message": "Animação de câmera a partir de imagem estática disponível. Não é geração de movimento por IA.",
            "fallback_reason": wan["message"],
        }
    return {
        "available": False,
        "status": wan["status"],
        "message": str(wan["message"]) + " FFmpeg também não está disponível para animação simples.",
    }



def validate_reference_image(image_bytes: bytes) -> None:
    """Valida o conteúdo real da imagem antes de enfileirar uma geração de vídeo."""
    if not image_bytes or len(image_bytes) > 18 * 1024 * 1024:
        raise ValueError("A imagem de referência deve ter até 18 MB.")
    try:
        from PIL import Image
        import io

        with Image.open(io.BytesIO(image_bytes)) as source:
            if source.format not in {"PNG", "JPEG"}:
                raise ValueError("Envie uma imagem PNG ou JPEG válida.")
            width, height = source.size
            if width < 1 or height < 1 or width > 8192 or height > 8192 or width * height > 40_000_000:
                raise ValueError("A imagem deve ter no máximo 8192 px por lado e 40 megapixels.")
            source.verify()
    except ValueError:
        raise
    except Exception as error:
        raise ValueError("A imagem de referência está corrompida ou não pôde ser lida.") from error

def validate_mp4_output(path: Path) -> None:
    if not path.is_file() or path.stat().st_size < 16:
        raise RuntimeError("O motor não produziu um arquivo de vídeo válido.")
    with path.open("rb") as generated_file:
        mp4_header = generated_file.read(12)
    if len(mp4_header) < 12 or mp4_header[4:8] != b"ftyp":
        raise RuntimeError("O motor terminou sem produzir um arquivo MP4 válido.")


def _generate_camera_motion_video(image_bytes: bytes, duration_seconds: float) -> Path:
    if not shutil.which(FFMPEG):
        raise RuntimeError("FFmpeg não está instalado para criar o movimento de câmera.")
    WAN_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output = WAN_OUTPUT_DIR / ("video-" + uuid.uuid4().hex + ".mp4")
    frames = max(24, min(120, round(duration_seconds * 24)))
    with tempfile.TemporaryDirectory(prefix="estudio-motion-") as temp_dir:
        temp = Path(temp_dir)
        image_path = temp / "reference.png"
        temporary_output = temp / "generated.mp4"
        try:
            from PIL import Image
            import io

            with Image.open(io.BytesIO(image_bytes)) as source:
                source.convert("RGB").save(image_path, format="PNG")
        except Exception as error:
            raise RuntimeError("A imagem enviada não pôde ser decodificada.") from error
        video_filter = (
            "scale=1280:720:force_original_aspect_ratio=increase,"
            "crop=1280:720,"
            f"zoompan=z='min(zoom+0.00035,1.04)':"
            "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
            f"d={frames}:s=1280x720:fps=24,"
            "format=yuv420p"
        )
        command = [
            FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
            "-loop", "1", "-framerate", "24", "-i", str(image_path),
            "-vf", video_filter, "-frames:v", str(frames),
            "-an", "-c:v", "libx264", "-preset", "veryfast",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart",
            str(temporary_output),
        ]
        try:
            result = subprocess.run(
                command, capture_output=True, text=True,
                timeout=max(60, round(duration_seconds * 30)), check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise RuntimeError("A animação simples excedeu o tempo máximo.") from error
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "Falha desconhecida no FFmpeg")[-1200:]
            raise RuntimeError("Não foi possível animar a imagem: " + detail)
        validate_mp4_output(temporary_output)
        shutil.copy2(temporary_output, output)
    return output


def wan_frame_count(duration_seconds: float) -> int:
    """Converte duração finita em frames válidos para o CLI Wan2.2 (4n + 1)."""
    if not math.isfinite(duration_seconds):
        raise ValueError("A duração do vídeo precisa ser um número finito.")
    frame_target = round(max(0.0, duration_seconds) * 24)
    return max(5, min(121, round((frame_target - 1) / 4) * 4 + 1))


def generate_wan_video(prompt: str, image_bytes: bytes, duration_seconds: float, seed: int | None) -> Path:
    status = video_engine_status()
    if not status["available"]:
        raise RuntimeError(str(status["message"]))
    if status["status"] == "ready_motion_only":
        return _generate_camera_motion_video(image_bytes, duration_seconds)

    from PIL import Image
    import io

    WAN_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    frame_num = wan_frame_count(duration_seconds)
    output = WAN_OUTPUT_DIR / ("video-" + uuid.uuid4().hex + ".mp4")
    with tempfile.TemporaryDirectory(prefix="wan-ti2v-") as temp_dir:
        temp = Path(temp_dir)
        image_path = temp / "reference.png"
        with Image.open(io.BytesIO(image_bytes)) as source:
            source.convert("RGB").save(image_path, format="PNG")
        temporary_output = temp / "generated.mp4"
        command = [
            WAN_PYTHON, str(WAN_GENERATE_SCRIPT.resolve()),
            "--task", "ti2v-5B", "--size", WAN_SIZE,
            "--ckpt_dir", str(WAN_CHECKPOINT_DIR.resolve()),
            "--offload_model", "True", "--convert_model_dtype", "--t5_cpu",
            "--frame_num", str(frame_num), "--prompt", prompt,
            "--image", str(image_path), "--save_file", str(temporary_output),
            "--base_seed", str(seed if seed is not None else -1),
        ]
        try:
            result = subprocess.run(
                command, cwd=str(WAN_GENERATE_SCRIPT.resolve().parent),
                capture_output=True, text=True, timeout=WAN_TIMEOUT_SECONDS, check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise RuntimeError("A geração Wan2.2 excedeu o tempo máximo configurado.") from error
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "Falha desconhecida no Wan2.2")[-1600:]
            raise RuntimeError("Wan2.2 não conseguiu gerar o clipe: " + detail)
        validate_mp4_output(temporary_output)
        shutil.copy2(temporary_output, output)
    return output
