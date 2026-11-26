from __future__ import annotations

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
WAN_MIN_FREE_VRAM_MB = max(24000, int(os.getenv("WAN_MIN_FREE_VRAM_MB", "24576")))
WAN_TIMEOUT_SECONDS = max(600, int(os.getenv("WAN_TIMEOUT_SECONDS", "10800")))
WAN_OUTPUT_DIR = Path(os.getenv("IMAGE_OUTPUT_DIR", os.getenv("RENDER_OUTPUT_DIR", "outputs"))).resolve()


def video_engine_status() -> dict[str, object]:
    if not WAN_GENERATE_SCRIPT.is_file():
        return {"available": False, "status": "wan_runtime_missing", "message": "Configure WAN_GENERATE_SCRIPT apontando para o generate.py oficial do Wan2.2."}
    if not os.getenv("WAN_CHECKPOINT_DIR", "").strip() or not WAN_CHECKPOINT_DIR.is_dir():
        return {"available": False, "status": "wan_model_missing", "message": "Configure WAN_CHECKPOINT_DIR apontando para os pesos Wan2.2 TI2V 5B já baixados."}
    if not (shutil.which(WAN_PYTHON) or Path(WAN_PYTHON).is_file()):
        return {"available": False, "status": "python_missing", "message": "O executável Python configurado em WAN_PYTHON não foi encontrado."}
    try:
        import torch
        if not torch.cuda.is_available():
            return {"available": False, "status": "gpu_unavailable", "message": "Wan2.2 TI2V 5B precisa de uma GPU CUDA compatível."}
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
            "message": f"Wan2.2 TI2V 5B requer aproximadamente 24 GB livres. Disponível agora: {free_mb} MB.",
        }
    return {
        "available": True,
        "status": "ready",
        "model": "Wan2.2 TI2V 5B",
        "device": "cuda",
        "vram_free_mb": free_mb,
        "vram_total_mb": total_mb,
        "message": "Runtime oficial e pesos Wan2.2 encontrados; a geração ainda deve ser validada com uma execução real.",
    }


def generate_wan_video(prompt: str, image_bytes: bytes, duration_seconds: float, seed: int | None) -> Path:
    status = video_engine_status()
    if not status["available"]:
        raise RuntimeError(str(status["message"]))
    from PIL import Image
    import io

    WAN_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    frame_target = round(duration_seconds * 24)
    frame_num = max(5, min(121, round((frame_target - 1) / 4) * 4 + 1))
    output = WAN_OUTPUT_DIR / ("video-" + uuid.uuid4().hex + ".mp4")
    with tempfile.TemporaryDirectory(prefix="wan-ti2v-") as temp_dir:
        temp = Path(temp_dir)
        image_path = temp / "reference.png"
        with Image.open(io.BytesIO(image_bytes)) as source:
            source.convert("RGB").save(image_path, format="PNG")
        temporary_output = temp / "generated.mp4"
        command = [
            WAN_PYTHON,
            str(WAN_GENERATE_SCRIPT.resolve()),
            "--task", "ti2v-5B",
            "--size", WAN_SIZE,
            "--ckpt_dir", str(WAN_CHECKPOINT_DIR.resolve()),
            "--offload_model", "True",
            "--convert_model_dtype",
            "--t5_cpu",
            "--frame_num", str(frame_num),
            "--prompt", prompt,
            "--image", str(image_path),
            "--save_file", str(temporary_output),
            "--base_seed", str(seed if seed is not None else -1),
        ]
        try:
            result = subprocess.run(
                command,
                cwd=str(WAN_GENERATE_SCRIPT.resolve().parent),
                capture_output=True,
                text=True,
                timeout=WAN_TIMEOUT_SECONDS,
                check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise RuntimeError("A geração Wan2.2 excedeu o tempo máximo configurado.") from error
        if result.returncode != 0 or not temporary_output.is_file() or temporary_output.stat().st_size == 0:
            detail = (result.stderr or result.stdout or "Falha desconhecida no Wan2.2")[-1600:]
            raise RuntimeError("Wan2.2 não conseguiu gerar o clipe: " + detail)
        shutil.copy2(temporary_output, output)
    return output
