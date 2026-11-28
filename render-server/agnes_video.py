from __future__ import annotations

import json
import os
import shutil
import time
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

AGNES_API_KEY = os.getenv("AGNES_API_KEY", "").strip()
AGNES_BASE_URL = os.getenv("AGNES_BASE_URL", "https://apihub.agnes-ai.com/v1").rstrip("/")
AGNES_TIMEOUT_SECONDS = max(60, int(os.getenv("AGNES_TIMEOUT_SECONDS", "1200")))
OUTPUT_DIR = Path(os.getenv("IMAGE_OUTPUT_DIR", os.getenv("RENDER_OUTPUT_DIR", "outputs"))).resolve()


def agnes_status() -> dict[str, object]:
    if not AGNES_API_KEY:
        return {
            "available": False,
            "status": "agnes_key_missing",
            "provider": "Agnes AI",
            "model": "agnes-video-2.5-flash",
            "message": "Agnes AI ainda não está conectado: falta configurar AGNES_API_KEY no servidor.",
        }

    # Fail closed: never submit a video task until the account's $0 access
    # has been checked in the Agnes console and explicitly confirmed by the owner.
    free_access_confirmed = os.getenv("AGNES_FREE_ACCESS_CONFIRMED", "").strip().lower() == "true"
    if not free_access_confirmed:
        return {
            "available": False,
            "status": "agnes_free_access_unconfirmed",
            "provider": "Agnes AI",
            "model": "agnes-video-2.5-flash",
            "resolution": "720P",
            "message": "Chave Agnes configurada, mas a geração está bloqueada até confirmar no painel da Agnes que o modelo Flash aparece com custo de US$ 0. Nenhuma solicitação será enviada.",
        }

    return {
        "available": True,
        "status": "agnes_configured_unverified",
        "provider": "Agnes AI",
        "model": "agnes-video-2.5-flash",
        "resolution": "720P",
        "message": "Acesso gratuito ao Agnes Flash confirmado pelo responsável; usando somente o modelo 720P.",
    }


def _request_json(url: str, method: str = "GET", payload: dict | None = None) -> dict:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={
            "Authorization": "Bearer " + AGNES_API_KEY,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    # A fila cheia significa que o provedor recusou a solicitação antes de
    # criar o job. Repetimos somente esse erro específico para evitar jobs
    # duplicados em falhas 503 genéricas ou em timeouts ambíguos.
    max_queue_retries = max(0, min(4, int(os.getenv("AGNES_QUEUE_RETRIES", "3"))))
    base_delay = max(1, min(60, int(os.getenv("AGNES_QUEUE_RETRY_DELAY_SECONDS", "15"))))
    for attempt in range(max_queue_retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                raw = response.read(2 * 1024 * 1024)
            break
        except urllib.error.HTTPError as error:
            detail = error.read(4000).decode("utf-8", "replace")
            try:
                error_body = json.loads(detail)
            except (TypeError, json.JSONDecodeError):
                error_body = {}
            queue_is_full = (
                error.code == 503
                and isinstance(error_body, dict)
                and error_body.get("code") == "video_queue_full"
            )
            if queue_is_full and attempt < max_queue_retries:
                delay = min(120, base_delay * (attempt + 1))
                time.sleep(delay)
                continue
            if queue_is_full:
                raise RuntimeError(
                    "A fila de vídeos da Agnes AI continua cheia após "
                    f"{max_queue_retries} tentativas automáticas. Aguarde alguns minutos e tente novamente. "
                    f"Detalhes: {detail}"
                ) from error
            raise RuntimeError(f"Agnes AI respondeu HTTP {error.code}: {detail}") from error
        except (urllib.error.URLError, TimeoutError) as error:
            raise RuntimeError(f"Não foi possível conectar à Agnes AI: {error}") from error
    try:
        result = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("Agnes AI retornou uma resposta inválida.") from error
    if not isinstance(result, dict):
        raise RuntimeError("Agnes AI retornou um formato de resposta inesperado.")
    return result


def _generate_huggingface_fallback(prompt: str, image_url: str, duration_seconds: float, seed: int | None) -> Path:
    """Usa o mesmo contrato Gradio validado no motor Hugging Face principal."""
    space_id = os.getenv("HF_VIDEO_SPACE_ID", "zerogpu-aoti/wan2-2-fp8da-aoti-faster").strip()
    if not space_id:
        raise RuntimeError("Space de vídeo Hugging Face não configurado.")
    try:
        from gradio_client import Client, handle_file
    except Exception as error:
        raise RuntimeError("Cliente Hugging Face Gradio não está instalado.") from error

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output = OUTPUT_DIR / ("video-" + uuid.uuid4().hex + ".mp4")
    with tempfile.TemporaryDirectory(prefix="agnes-hf-fallback-") as temp_dir:
        image_path = Path(temp_dir) / "reference.png"
        request = urllib.request.Request(image_url, headers={"Accept": "image/*"})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                image_bytes = response.read(20 * 1024 * 1024 + 1)
            if len(image_bytes) > 20 * 1024 * 1024:
                raise RuntimeError("A imagem de referência excede o limite de 20 MB.")
            from PIL import Image
            import io
            with Image.open(io.BytesIO(image_bytes)) as source:
                source.convert("RGB").save(image_path, format="PNG")
        except Exception as error:
            raise RuntimeError("Não foi possível baixar ou preparar a imagem para o Hugging Face.") from error

        try:
            client = Client(space_id, token=os.getenv("HF_TOKEN", "").strip() or None, verbose=False)
            result = client.predict(
                handle_file(str(image_path)),
                prompt or "Cinematic 2D anime animation. The characters move naturally with visible body movement, expressive facial motion, blinking and gestures. Preserve character identity, clothing, composition and art style. Keep the camera mostly steady.",
                6,
                "static image, frozen character, deformed body, extra limbs, extra fingers, blurry face, text, watermark",
                max(0.5, min(5.0, float(duration_seconds))),
                1.0,
                1.0,
                int(seed if seed is not None else 42),
                seed is None,
                api_name="/generate_video",
            )
        except Exception as error:
            raise RuntimeError("O motor Hugging Face não conseguiu gerar o vídeo: " + str(error).strip()[-1000:]) from error

        video_path = result[0] if isinstance(result, (tuple, list)) else result
        if isinstance(video_path, dict):
            video_path = video_path.get("path") or video_path.get("name")
        if not video_path or not Path(str(video_path)).is_file():
            raise RuntimeError("Hugging Face respondeu, mas não retornou um arquivo de vídeo acessível.")
        shutil.copy2(str(video_path), output)

    with output.open("rb") as generated:
        header = generated.read(12)
    if len(header) < 12 or header[4:8] != b"ftyp":
        output.unlink(missing_ok=True)
        raise RuntimeError("O motor alternativo não retornou um MP4 válido.")
    return output


def generate_agnes_video(prompt: str, image_url: str, duration_seconds: float, seed: int | None) -> Path:
    # Independent safety guard: never call Agnes unless the owner explicitly confirms $0 access.
    if os.getenv("AGNES_FREE_ACCESS_CONFIRMED", "").strip().lower() != "true":
        raise RuntimeError("Geração Agnes bloqueada: confirme primeiro no painel que o custo da sua conta é US$ 0. Nenhuma solicitação foi enviada.")
    if not AGNES_API_KEY:
        raise RuntimeError("Configure AGNES_API_KEY no servidor para usar Agnes AI.")
    if not image_url.startswith("https://"):
        raise RuntimeError("A imagem de referência precisa de um endereço HTTPS público temporário.")
    seconds = str(max(4, min(12, round(float(duration_seconds)))))
    payload: dict[str, object] = {
        "model": "agnes-video-2.5-flash",
        "prompt": prompt,
        "mode": "reference",
        "seconds": seconds,
        "size": "720P",
        "aspect_ratio": "16:9",
        "images": [image_url],
        "n": 1,
    }
    if seed is not None:
        payload["seed"] = int(seed)

    try:
        created = _request_json(AGNES_BASE_URL + "/videos", "POST", payload)
    except RuntimeError as error:
        if "video_queue_full" not in str(error):
            raise
        try:
            return _generate_huggingface_fallback(prompt, image_url, duration_seconds, seed)
        except Exception as fallback_error:
            raise RuntimeError(
                "A fila gratuita da Agnes AI continua cheia e o motor gratuito alternativo também falhou. "
                "Nenhum serviço pago foi acionado. Agnes: " + str(error)[-700:] +
                " | Hugging Face: " + str(fallback_error)[-700:]
            ) from fallback_error
    video_id = created.get("video_id")
    if not isinstance(video_id, str) or not video_id:
        raise RuntimeError("Agnes AI não retornou video_id para acompanhar a geração.")

    query = urllib.parse.urlencode({
        "video_id": video_id,
        "model_name": "agnes-video-2.5-flash",
    })
    poll_url = AGNES_BASE_URL.rsplit("/v1", 1)[0] + "/agnesapi?" + query
    deadline = time.monotonic() + AGNES_TIMEOUT_SECONDS
    result: dict = {}
    while time.monotonic() < deadline:
        result = _request_json(poll_url)
        status = str(result.get("status", "")).lower()
        if status == "completed":
            break
        if status == "failed":
            error = result.get("error")
            raise RuntimeError("Agnes AI não conseguiu gerar o vídeo: " + str(error)[:1200])
        time.sleep(2)
    else:
        raise RuntimeError("A geração Agnes AI excedeu o tempo de espera configurado.")

    video_url = result.get("url")
    if not isinstance(video_url, str) or not video_url.startswith("https://"):
        raise RuntimeError("Agnes AI concluiu a tarefa, mas não retornou um link HTTPS para o vídeo.")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output = OUTPUT_DIR / ("video-" + uuid.uuid4().hex + ".mp4")
    request = urllib.request.Request(video_url, headers={"Accept": "video/mp4"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response, output.open("wb") as target:
            shutil.copyfileobj(response, target)
    except Exception as error:
        output.unlink(missing_ok=True)
        raise RuntimeError(f"Não foi possível baixar o vídeo gerado pela Agnes AI: {error}") from error
    if not output.is_file() or output.stat().st_size < 16:
        output.unlink(missing_ok=True)
        raise RuntimeError("Agnes AI retornou um arquivo de vídeo vazio.")
    return output
