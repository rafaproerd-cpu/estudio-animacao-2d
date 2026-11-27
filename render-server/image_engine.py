from __future__ import annotations

import io
import os
import threading
import tempfile
import uuid
import urllib.error
import urllib.request
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
HF_SPACE_ID = os.getenv("HF_SPACE_ID", "mrfakename/Z-Image-Turbo").strip()
HF_SPACE_MODE = os.getenv("HF_SPACE_MODE", "public_zimage").strip().lower()
HF_TOKEN = os.getenv("HF_TOKEN", "").strip()
CLOUDFLARE_ACCOUNT_ID = os.getenv("CLOUDFLARE_ACCOUNT_ID", "").strip()
CLOUDFLARE_API_TOKEN = os.getenv("CLOUDFLARE_API_TOKEN", "").strip()
CLOUDFLARE_IMAGE_MODEL = os.getenv("CLOUDFLARE_IMAGE_MODEL", "@cf/black-forest-labs/flux-1-schnell").strip()


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
    token_configured = bool(HF_TOKEN)
    return {
        "available": True,
        "status": "configured_unverified",
        "provider": "Hugging Face ZeroGPU",
        "space_id": HF_SPACE_ID,
        "mode": HF_SPACE_MODE,
        "authentication": "token_configured" if token_configured else "anonymous",
        "token_configured": token_configured,
        "message": (
            "Space configurado; token do Hugging Face detectado no servidor, mas a conexão e a geração ainda não foram testadas."
            if token_configured
            else "Space configurado sem token do Hugging Face. O servidor tentará acesso público, sujeito às cotas anônimas; configure HF_TOKEN no Render para usar sua conta. A geração ainda não foi testada."
        ),
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
        token=HF_TOKEN or None,
        verbose=False,
    )
    if HF_SPACE_MODE == "public_zimage":
        # Public Z-Image-Turbo community Space API:
        # prompt, height, width, inference steps, seed, randomize seed.
        # It is text-to-image only; reference images are not supported by this Space.
        result = client.predict(
            prompt,
            int(height),
            int(width),
            9,
            int(seed or 12345),
            False,
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


def diagnose_huggingface_image_space() -> dict[str, object]:
    """Check Gradio Space reachability and API metadata without running inference."""
    status = huggingface_image_engine_status()
    if not status.get("available"):
        return {**status, "connectivity": "not_checked"}
    try:
        from gradio_client import Client

        client = Client(HF_SPACE_ID, token=HF_TOKEN or None, verbose=False)
        api = client.view_api(return_format="dict")
        named = api.get("named_endpoints", {}) if isinstance(api, dict) else {}
        expected = "/generate_image" if HF_SPACE_MODE == "public_zimage" else "/generate"
        endpoint = named.get(expected) if isinstance(named, dict) else None
        if endpoint is None and isinstance(named, dict):
            endpoint = named.get(expected.lstrip("/"))
        if endpoint is None:
            available_endpoints = sorted(str(name) for name in named) if isinstance(named, dict) else []
            return {
                **status,
                "connectivity": "reachable_api_mismatch",
                "expected_endpoint": expected,
                "available_endpoints": available_endpoints[:30],
                "message": "O Space respondeu, mas não publicou o endpoint esperado " + expected + ".",
            }
        return {
            **status,
            "connectivity": "reachable",
            "expected_endpoint": expected,
            "endpoint_verified": True,
            "message": "Conexão com o Space confirmada e endpoint " + expected + " encontrado. Nenhuma imagem foi gerada neste diagnóstico.",
        }
    except Exception as error:
        detail = " ".join(str(error).split())[:900] or error.__class__.__name__
        return {
            **status,
            "connectivity": "connection_failed",
            "endpoint_verified": False,
            "diagnostic_error": detail,
            "message": "Não foi possível consultar a API do Space: " + detail,
        }


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


def generate_cloudflare_image(
    prompt: str,
    seed: int | None,
) -> Path:
    """Generate a fallback image through Cloudflare Workers AI's free daily allocation."""
    if not CLOUDFLARE_ACCOUNT_ID or not CLOUDFLARE_API_TOKEN:
        raise RuntimeError("Cloudflare não configurado: defina CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_API_TOKEN no Render.")
    import base64
    import json

    endpoint = (
        "https://api.cloudflare.com/client/v4/accounts/"
        + CLOUDFLARE_ACCOUNT_ID
        + "/ai/run/"
        + CLOUDFLARE_IMAGE_MODEL
    )
    payload = {"prompt": prompt[:2048], "steps": 4}
    if seed is not None:
        payload["seed"] = int(seed)
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + CLOUDFLARE_API_TOKEN,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:700]
        raise RuntimeError("Cloudflare Workers AI respondeu HTTP " + str(error.code) + ": " + detail) from error
    except Exception as error:
        raise RuntimeError("Falha ao conectar ao Cloudflare Workers AI: " + str(error)[:500]) from error

    encoded = (body.get("result") or {}).get("image") if isinstance(body, dict) else None
    if not encoded:
        raise RuntimeError("Cloudflare não retornou a imagem esperada.")
    try:
        image_bytes = base64.b64decode(encoded, validate=True)
    except Exception as error:
        raise RuntimeError("Cloudflare retornou uma imagem Base64 inválida.") from error

    IMAGE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output = IMAGE_OUTPUT_DIR / ("image-cloudflare-" + uuid.uuid4().hex + ".png")
    from PIL import Image
    with Image.open(io.BytesIO(image_bytes)) as image:
        image.convert("RGB").save(output, format="PNG")
    return output


def generate_image(
    prompt: str,
    negative_prompt: str | None,
    width: int,
    height: int,
    seed: int | None,
    reference_image_bytes: bytes | None = None,
) -> Path:
    """Prefer local SDXL, then Hugging Face; use Cloudflare if the hosted Space fails."""
    if image_engine_status()["available"]:
        return generate_sdxl_image(
            prompt=prompt,
            negative_prompt=negative_prompt,
            width=width,
            height=height,
            seed=seed,
            reference_image_bytes=reference_image_bytes,
        )
    try:
        return generate_huggingface_image(
            prompt=prompt,
            width=width,
            height=height,
            seed=seed,
            reference_image_bytes=reference_image_bytes,
        )
    except Exception as hf_error:
        if not CLOUDFLARE_ACCOUNT_ID or not CLOUDFLARE_API_TOKEN:
            raise
        try:
            return generate_cloudflare_image(prompt=prompt, seed=seed)
        except Exception as cloudflare_error:
            raise RuntimeError(
                "Hugging Face falhou: " + str(hf_error)[:450]
                + " | Cloudflare também falhou: " + str(cloudflare_error)[:450]
            ) from cloudflare_error
