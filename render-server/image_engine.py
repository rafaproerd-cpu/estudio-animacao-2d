from __future__ import annotations

import os
import threading
import uuid
from pathlib import Path
from typing import Any

IMAGE_MODEL_ID = os.getenv("IMAGE_MODEL_ID", "").strip()
IMAGE_DEVICE = os.getenv("IMAGE_DEVICE", "cuda").strip().lower()
IMAGE_STEPS = max(10, min(int(os.getenv("IMAGE_STEPS", "25")), 50))
IMAGE_MIN_FREE_VRAM_MB = max(6000, int(os.getenv("IMAGE_MIN_FREE_VRAM_MB", "8000")))
IMAGE_OUTPUT_DIR = Path(os.getenv("IMAGE_OUTPUT_DIR", os.getenv("RENDER_OUTPUT_DIR", "outputs"))).resolve()

_pipeline: Any = None
_pipeline_lock = threading.Lock()


def image_engine_status() -> dict[str, object]:
    if not IMAGE_MODEL_ID:
        return {"available": False, "status": "not_configured", "message": "Defina IMAGE_MODEL_ID após instalar um checkpoint SDXL."}
    try:
        import importlib.util
        has_torch = importlib.util.find_spec("torch") is not None
        has_diffusers = importlib.util.find_spec("diffusers") is not None
    except (ImportError, ValueError):
        has_torch = has_diffusers = False
    if not has_torch or not has_diffusers:
        return {"available": False, "status": "dependencies_missing", "message": "Instale PyTorch compatível com o driver e Diffusers para ativar SDXL."}
    try:
        import torch
        cuda_available = bool(torch.cuda.is_available())
    except Exception:
        cuda_available = False
    if IMAGE_DEVICE == "cuda" and not cuda_available:
        return {"available": False, "status": "gpu_unavailable", "message": "IMAGE_DEVICE=cuda, mas PyTorch não detectou uma GPU CUDA disponível."}
    if IMAGE_DEVICE == "cuda":
        try:
            free_bytes, total_bytes = torch.cuda.mem_get_info()
            free_mb = int(free_bytes / (1024 * 1024))
            total_mb = int(total_bytes / (1024 * 1024))
            if free_mb < IMAGE_MIN_FREE_VRAM_MB:
                return {
                    "available": False,
                    "status": "insufficient_vram",
                    "device": IMAGE_DEVICE,
                    "vram_free_mb": free_mb,
                    "vram_total_mb": total_mb,
                    "message": f"SDXL requer margem de memória GPU. Disponível: {free_mb} MB; mínimo configurado: {IMAGE_MIN_FREE_VRAM_MB} MB.",
                }
        except Exception:
            return {"available": False, "status": "gpu_diagnostics_failed", "message": "Não foi possível consultar a memória livre da GPU CUDA."}
    if IMAGE_DEVICE not in {"cuda", "cpu"}:
        return {"available": False, "status": "invalid_device", "message": "IMAGE_DEVICE deve ser cuda ou cpu."}
    if IMAGE_DEVICE == "cpu" and os.getenv("IMAGE_ALLOW_CPU", "").lower() not in {"1", "true", "yes"}:
        return {"available": False, "status": "cpu_disabled", "message": "CPU é desativada por padrão para evitar geração excessivamente lenta. Defina IMAGE_ALLOW_CPU=true para habilitar conscientemente."}
    return {"available": True, "status": "ready", "model": IMAGE_MODEL_ID, "device": IMAGE_DEVICE, "message": "Motor SDXL configurado; o primeiro uso pode baixar pesos e demorar."}


def generate_sdxl_image(prompt: str, negative_prompt: str | None, width: int, height: int, seed: int | None) -> Path:
    global _pipeline
    status = image_engine_status()
    if not status["available"]:
        raise RuntimeError(str(status["message"]))
    import torch
    from diffusers import StableDiffusionXLPipeline

    IMAGE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with _pipeline_lock:
        if _pipeline is None:
            dtype = torch.float16 if IMAGE_DEVICE == "cuda" else torch.float32
            kwargs: dict[str, object] = {"torch_dtype": dtype, "use_safetensors": True}
            if IMAGE_DEVICE == "cuda":
                kwargs["variant"] = "fp16"
            _pipeline = StableDiffusionXLPipeline.from_pretrained(IMAGE_MODEL_ID, **kwargs)
            _pipeline = _pipeline.to(IMAGE_DEVICE)
            if IMAGE_DEVICE == "cuda":
                _pipeline.enable_attention_slicing()
        generator = torch.Generator(device=IMAGE_DEVICE)
        if seed is not None:
            generator = generator.manual_seed(seed)
        result = _pipeline(
            prompt=prompt,
            negative_prompt=negative_prompt or None,
            width=width,
            height=height,
            num_inference_steps=IMAGE_STEPS,
            generator=generator,
        )
        image = result.images[0]
        output = IMAGE_OUTPUT_DIR / ("image-" + uuid.uuid4().hex + ".png")
        image.save(output, format="PNG")
        return output
