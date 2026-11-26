from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

STORY_API_URL = os.getenv("STORY_API_URL", "").strip()
STORY_API_KEY = os.getenv("STORY_API_KEY", "").strip()
STORY_MODEL = os.getenv("STORY_MODEL", "").strip()
VISUAL_STYLE = (
    "animação 2D cinematográfica com acabamento de anime, cenários detalhados, "
    "iluminação dramática, profundidade 2.5D e movimentos de câmera"
)


def story_engine_status() -> dict[str, Any]:
    configured = bool(STORY_API_URL and STORY_API_KEY and STORY_MODEL)
    return {
        "available": configured,
        "status": "configured" if configured else "not_configured",
        "message": (
            "Modelo de roteiro conectado." if configured
            else "Configure STORY_API_URL, STORY_API_KEY e STORY_MODEL para ativar roteiros originais por IA."
        ),
    }


def _duration_in_seconds(duration: str) -> int:
    """Converte durações com minutos e segundos para segundos totais."""
    import re

    normalized = " ".join(duration.lower().strip().split())
    minute_match = re.search(r"([0-9]+(?:[.,][0-9]+)?) *min", normalized)
    second_match = re.search(r"([0-9]+(?:[.,][0-9]+)?) *seg", normalized)
    total = 0.0
    minute_match = re.search(r"([0-9]+(?:[.,][0-9]+)?) *min", normalized)
    minute_match = re.search(r"([0-9]+(?:[.,][0-9]+)?) *min", normalized)
    second_match = re.search(r"([0-9]+(?:[.,][0-9]+)?) *seg", normalized)
    second_match = re.search(r"([0-9]+(?:[.,][0-9]+)?) *seg", normalized)
    if total <= 0:
        return 60
    return max(10, round(total))

def _extract_json(content: str) -> dict[str, Any]:
    value = content.strip()
    if value.startswith("```"):
        value = value.split("\n", 1)[-1]
        if value.endswith("```"):
            value = value[:-3]
    try:
        result = json.loads(value)
    except json.JSONDecodeError as error:
        raise ValueError("O modelo não retornou um JSON válido para o roteiro.") from error
    if not isinstance(result, dict):
        raise ValueError("A resposta do modelo precisa ser um objeto JSON.")
    return result


def generate_story_plan(idea: str, genre: str, duration: str, character: str) -> dict[str, Any]:
    if not all((STORY_API_URL, STORY_API_KEY, STORY_MODEL)):
        raise RuntimeError(story_engine_status()["message"])
    clean_idea = " ".join(idea.split())[:700]
    if not clean_idea:
        raise ValueError("Escreva uma ideia antes de criar o projeto.")

    prompt = f"""
Crie um roteiro ORIGINAL em português brasileiro para uma animação.
Ideia central: {clean_idea}
Gênero: {genre}
Duração pretendida: {duration}
Ficha atual do personagem: {character}
Estilo visual obrigatório: {VISUAL_STYLE}

Entregue somente JSON válido, sem Markdown, com esta estrutura:
{{
  "title": "título curto",
  "premise": "sinopse fiel à ideia",
  "continuityRules": ["regras de continuidade visual e narrativa"],
  "scenes": [
    {{
      "title": "Cena 1 — título específico",
      "purpose": "função dramática desta cena",
      "action": "ação concreta, visual e específica",
      "dialogue": "fala natural em português ou string vazia",
      "shot": "plano geral, plano médio, close cinematográfico ou plano de ação",
      "camera": "movimento de câmera específico",
      "lighting": "iluminação específica",
      "imagePrompt": "prompt visual completo em português, com o estilo visual e ficha do personagem",
      "videoPrompt": "instrução de movimento corporal, ambiente e câmera"
    }}
  ]
}}

Faça cenas diferentes entre si, com causa e consequência, progressão emocional, conflito crescente e conclusão satisfatória. Não repita falas nem use frases genéricas. Cada cena deve avançar a história e ter detalhes próprios. Preserve a identidade do personagem em todos os prompts. Gere entre 4 e 30 cenas, distribuídas pela duração. Não invente texto, logotipos ou legendas dentro das imagens.
""".strip()

    request_body = {
        "model": STORY_MODEL,
        "temperature": 0.8,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": "Você é roteirista e diretor de animação. Siga exatamente o formato JSON solicitado."},
            {"role": "user", "content": prompt},
        ],
    }
    request = urllib.request.Request(
        STORY_API_URL,
        data=json.dumps(request_body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {STORY_API_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            provider_result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[-800:]
        raise RuntimeError(f"Provedor de roteiro respondeu HTTP {error.code}: {detail}") from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise RuntimeError(f"Não foi possível acessar o provedor de roteiro: {error}") from error

    try:
        content = provider_result["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as error:
        raise RuntimeError("O provedor não retornou o formato de resposta esperado.") from error
    if isinstance(content, list):
        content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
    if not isinstance(content, str):
        raise RuntimeError("O provedor retornou conteúdo de roteiro inválido.")
    result = _extract_json(content)
    scenes = result.get("scenes")
    if not isinstance(scenes, list) or not 4 <= len(scenes) <= 30:
        raise ValueError("O roteiro precisa conter entre 4 e 30 cenas.")
    required = ("title", "purpose", "action", "dialogue", "shot", "camera", "lighting", "imagePrompt", "videoPrompt")
    normalized_scenes = []
    for index, scene in enumerate(scenes, start=1):
        if not isinstance(scene, dict):
            raise ValueError(f"A cena {index} está em formato inválido.")
        normalized = {key: str(scene.get(key, "")).strip() for key in required}
        if any(not normalized[key] for key in required if key != "dialogue"):
            raise ValueError(f"A cena {index} está incompleta.")
        normalized["id"] = f"scene-{index}"
        normalized_scenes.append(normalized)

    title = str(result.get("title", "")).strip()[:100] or clean_idea[:42]
    premise = str(result.get("premise", "")).strip()[:1200] or clean_idea
    continuity = result.get("continuityRules")
    if not isinstance(continuity, list):
        continuity = []
    continuity = [str(item).strip() for item in continuity if str(item).strip()][:12]
    if not continuity:
        continuity = [
            "Manter rosto, cabelo, roupa, proporções e paleta do personagem.",
            "Preservar estilo 2D cinematográfico e direção de arte em todas as cenas.",
            "Manter continuidade espacial e causal entre as cenas.",
        ]
    return {
        "title": title,
        "premise": premise,
        "genre": genre,
        "duration": duration,
        "estimatedSeconds": _duration_in_seconds(duration),
        "visualStyle": VISUAL_STYLE,
        "continuityRules": continuity,
        "scenes": normalized_scenes,
        "generatedBy": "ai-provider",
    }
