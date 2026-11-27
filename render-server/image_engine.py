from __future__ import annotations

import io
import os
import threading
import tempfile
import uuid
from pathlib import Path
from typing import Any

IMAGE_MODEL_ID = os.getenv("IMAGE_MODEL_ID", "").strip()
IMAGE_DEVICE = os.getenv("IMAGE_DEVICE", "cuda").strip().lower()
IMAGE_STEPS = max(10, min(int(os.getenv("IMAGE_STEPS", "25")), 50))
IMAGE_MIN_FREE_VRAM_MB = max(6000, int(os.getenv("IMAGE_MIN_FREE_VRAM_MB", "8000")))
IMAGE_OUTPUT_DIR = Path(os.getenv("IMAGE_OUTPUT_DIR", os.getenv("RENDER_OUTPUT_DIR", "outputs"))).resolve()

_pipeline: Any = None
_pipeline_kind: str | None = None
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


def generate_sdxl_image(
    prompt: str,
    negative_prompt: str | None,
    width: int,
    height: int,
    seed: int | None,
    reference_image_bytes: bytes | None = None,
) -> Path:
    global _pipeline, _pipeline_kind
    status = image_engine_status()
    if not status["available"]:
        raise RuntimeError(str(status["message"]))
    import torch
    from PIL import Image
    from diffusers import StableDiffusionXLImg2ImgPipeline, StableDiffusionXLPipeline

    IMAGE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    pipeline_kind = "img2img" if reference_image_bytes else "txt2img"
    with _pipeline_lock:
        if _pipeline is None or _pipeline_kind != pipeline_kind:
            if _pipeline is not None:
                del _pipeline
                _pipeline = None
                if IMAGE_DEVICE == "cuda":
                    torch.cuda.empty_cache()
            dtype = torch.float16 if IMAGE_DEVICE == "cuda" else torch.float32
            kwargs: dict[str, object] = {"torch_dtype": dtype, "use_safetensors": True}
            if IMAGE_DEVICE == "cuda":
                kwargs["variant"] = "fp16"
            pipeline_class = StableDiffusionXLImg2ImgPipeline if reference_image_bytes else StableDiffusionXLPipeline
            _pipeline = pipeline_class.from_pretrained(IMAGE_MODEL_ID, **kwargs)
            _pipeline = _pipeline.to(IMAGE_DEVICE)
            if IMAGE_DEVICE == "cuda":
                _pipeline.enable_attention_slicing()
            _pipeline_kind = pipeline_kind

        generator = torch.Generator(device=IMAGE_DEVICE)
        if seed is not None:
            generator = generator.manual_seed(seed)
        arguments: dict[str, object] = {
            "prompt": prompt,
            "negative_prompt": negative_prompt or None,
            "num_inference_steps": IMAGE_STEPS,
            "generator": generator,
        }
        if reference_image_bytes:
            with Image.open(io.BytesIO(reference_image_bytes)) as source:
                reference = source.convert("RGB").resize((width, height), Image.Resampling.LANCZOS)
            arguments.update({
                "image": reference,
                "strength": max(0.25, min(float(os.getenv("IMAGE_REFERENCE_STRENGTH", "0.55")), 0.8)),
                "guidance_scale": 7.0,
            })
        else:
            arguments.update({"width": width, "height": height})
        result = _pipeline(**arguments)
        image = result.images[0]
        output = IMAGE_OUTPUT_DIR / ("image-" + uuid.uuid4().hex + ".png")
        image.save(output, format="PNG")
        return output


# Optional hosted inference through a Hugging Face Gradio Space.
# The token is read only by this server and must never be sent to the mobile app.
# Default to a public community ZeroGPU Space so a new free account does not
# need to host its own Space. The caller's HF token is used only on this server.
HF_SPACE_ID = os.getenv("HF_SPACE_ID", "akhaliq/Z-Image-Turbo").strip()
HF_SPACE_MODE = os.getenv("HF_SPACE_MODE", "public_zimage").strip().lower()
HF_TOKEN = os.getenv("HF_TOKEN", "").strip()


def huggingface_image_engine_status() -> dict[str, object]:
    if not HF_SPACE_ID:
        return {
            "available": False,
            "status": "not_configured",
            "message": "Configure HF_SPACE_ID com um Space Gradio público compatível para habilitar a geração remota.",
        }
    try:
        import importlib.util
        installed = importlib.util.find_spec("gradio_client") is not None
    except (ImportError, ValueError):
        installed = False
    if not installed:
        return {
            "available": False,
            "status": "dependencies_missing",
            "message": "Instale gradio_client no servidor para conectar ao Space.",
        }
    return {
        "available": True,
        "status": "configured_unverified",
        "provider": "Hugging Face ZeroGPU",
        "space_id": HF_SPACE_ID,
        "mode": HF_SPACE_MODE,
        "message": "Space público configurado. A disponibilidade real depende da fila e da cota ZeroGPU da conta autenticada.",
    }


def generate_huggingface_image(
    prompt: str,
    width: int,
    height: int,
    seed: int | None,
    reference_image_bytes: bytes | None = None,
) -> Path:
    """Generate an image through a hosted Gradio Space and copy its result locally."""
    status = huggingface_image_engine_status()
    if not status["available"]:
        raise RuntimeError(str(status["message"]))

    from gradio_client import Client

    IMAGE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    client = Client(
        HF_SPACE_ID,
        hf_token=HF_TOKEN or None,
        verbose=False,
    )
    if HF_SPACE_MODE == "public_zimage":
        # Public Z-Image-Turbo community Space API (akhaliq backend):
        # prompt, height, width, inference steps, seed, randomize seed.
        # It is text-to-image only; reference images are not supported by this Space.
        result = client.predict(
            prompt,
            int(height),
            int(width),
            9,
            int(seed or 12345),
            True,
            api_name="/generate_image",
        )
    else:
        # Compatibility mode for the project's own Gradio Space template.
        reference_path = None
        try:
            if reference_image_bytes:
                suffix = ".png" if reference_image_bytes.startswith(b"\x89PNG") else ".jpg"
                with tempfile.NamedTemporaryFile(prefix="estudio-reference-", suffix=suffix, delete=False) as temporary:
                    temporary.write(reference_image_bytes)
                    reference_path = Path(temporary.name)
            result = client.predict(
                prompt,
                int(seed or 12345),
                str(reference_path) if reference_path else None,
                api_name="/generate",
            )
        finally:
            if reference_path:
                reference_path.unlink(missing_ok=True)

    # Gradio image outputs may be a tuple (image, seed), FileData mapping or path.
    candidate = result
    if isinstance(candidate, (list, tuple)):
        if not candidate:
            raise RuntimeError("O Space retornou uma resposta de imagem vazia.")
        candidate = candidate[0]
    if isinstance(candidate, dict):
        candidate = candidate.get("path")
    elif not isinstance(candidate, (str, Path)):
        candidate = getattr(candidate, "path", None)
    if not isinstance(candidate, (str, Path)) or not str(candidate):
        raise RuntimeError("O Space não retornou um arquivo de imagem reconhecido.")

    source = Path(candidate)
    if not source.is_file():
        raise RuntimeError("O arquivo de imagem retornado pelo Space não está acessível no servidor.")
    output = IMAGE_OUTPUT_DIR / ("image-hf-" + uuid.uuid4().hex + ".png")
    # Re-encode as PNG to normalize the downloaded Space result.
    from PIL import Image
    with Image.open(source) as image:
        image.convert("RGB").save(output, format="PNG")
    return output


def active_image_engine_status() -> dict[str, object]:
    local = image_engine_status()
    if local["available"]:
        return local
    remote = huggingface_image_engine_status()
    if remote["available"]:
        return remote
    return {
        "available": False,
        "status": "not_configured",
        "message": str(local.get("message", "Motor local indisponível"))
        + " "
        + str(remote.get("message", "Motor remoto indisponível")),
        "local": local,
        "remote": remote,
    }


def generate_image(
    prompt: str,
    negative_prompt: str | None,
    width: int,
    height: int,
    seed: int | None,
    reference_image_bytes: bytes | None = None,
) -> Path:
    """Prefer a configured local SDXL engine; otherwise use the hosted Space."""
    if image_engine_status()["available"]:
        return generate_sdxl_image(
            prompt=prompt,
            negative_prompt=negative_prompt,
            width=width,
            height=height,
            seed=seed,
            reference_image_bytes=reference_image_bytes,
        )
    return generate_huggingface_image(
        prompt=prompt,
        width=width,
        height=height,
        seed=seed,
        reference_image_bytes=reference_image_bytes,
    )
