from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

STORY_API_URL = os.getenv("STORY_API_URL", "https://openrouter.ai/api/v1/chat/completions").strip()
STORY_API_KEY = os.getenv("STORY_API_KEY", "").strip()
STORY_MODEL = os.getenv("STORY_MODEL", "openrouter/free").strip()
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
            else "Configure apenas STORY_API_KEY no Render. O endpoint e o modelo gratuito OpenRouter já vêm configurados por padrão."
        ),
    }


def _duration_in_seconds(duration: str) -> int:
    """Converte durações com minutos e segundos para segundos totais."""
    import re

    normalized = " ".join(duration.lower().strip().split())
    minute_match = re.search(r"([0-9]+(?:[.,][0-9]+)?) *min", normalized)
    second_match = re.search(r"([0-9]+(?:[.,][0-9]+)?) *seg", normalized)
    total = 0.0
    if minute_match:
        total += float(minute_match.group(1).replace(",", ".")) * 60
    if second_match:
        total += float(second_match.group(1).replace(",", "."))
    if total <= 0:
        return 60
    return max(1, round(total))

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
Você é o ROTEIRISTA-CHEFE e DIRETOR CRIATIVO de um estúdio profissional de animação.
Sua missão não é preencher um modelo: é transformar uma ideia curta em uma história memorável,
emocionante, visualmente inventiva e pronta para virar animação.

BRIEFING
IDEIA DO USUÁRIO: {clean_idea}
GÊNERO PRINCIPAL: {genre}
DURAÇÃO: {duration}
PERSONAGEM / CONTINUIDADE: {character}
LINGUAGEM: português brasileiro natural, contemporâneo e expressivo.
DIREÇÃO VISUAL: {VISUAL_STYLE}

LIBERDADE CRIATIVA (MUITO IMPORTANTE)
- O usuário pode fornecer apenas uma frase. Complete por conta própria as lacunas: protagonista,
  desejo, personalidade, cenário, personagens secundários, obstáculo, antagonismo e stakes.
- Seja ousado e específico. Crie uma premissa própria, imagens marcantes, situações inesperadas
  e uma reviravolta que faça sentido quando o público olhar para trás.
- Não peça mais informações. Tome decisões criativas coerentes com a ideia e o gênero.
- Não transforme a ideia do usuário em outra história: preserve seu núcleo e amplie-o.
- Fuja de clichês automáticos, moral da história explícita, coincidências convenientes e soluções fáceis.
- Dê aos personagens desejos, medos, contradições e vozes diferentes. Eles não devem falar como narradores
  explicando o que a imagem já mostra.
- Diálogo curto, falável e com subtexto. Use silêncio quando a ação contar melhor a história.
- Cada cena precisa ter uma imagem ou ação memorável. Não repita a mesma composição, ação ou emoção.

ARQUITETURA DRAMÁTICA
1. Abertura com um gancho visual ou acontecimento intrigante nos primeiros segundos.
2. Apresente rapidamente quem é o protagonista, o que quer e o que pode perder.
3. Incidente que coloca a história em movimento; não demore em exposição.
4. Obstáculos que pioram por causa das escolhas dos personagens. Cada cena causa a próxima.
5. Uma descoberta, erro, traição ou mudança de perspectiva que altere o rumo da trama.
6. Clímax com decisão difícil e ação visual clara — o protagonista precisa agir, não apenas assistir.
7. Desfecho emocionalmente satisfatório, com consequência concreta e imagem final marcante.
Ajuste a intensidade ao gênero. Em comédia, construa escalada e payoff; em mistério, plante pistas
e entregue uma revelação justa; em aventura/ação, varie set pieces e objetivos; em drama, priorize
escolhas e relações; em fantasia, estabeleça regras e custos para o extraordinário.

DIREÇÃO PARA ANIMAÇÃO
- Planeje entre 4 e 30 cenas, em ritmo compatível com a duração. Cada cena deve funcionar como um clipe
  curto e animável, com uma ação principal legível.
- Escreva ações filmáveis: quem faz o quê, onde, com que objeto, e qual consequência visível acontece.
  Evite frases abstratas como "a tensão aumenta" sem mostrar como isso aparece na tela.
- Varie planos e movimentos de câmera por intenção dramática. Não use zoom ou travelling em todas.
- Inclua movimento corporal concreto, expressão facial, interação com objetos e movimento do ambiente.
- Mantenha geografia, figurino, aparência, objetos importantes e direção de movimento consistentes.
- Se houver fala, escreva falas específicas do personagem, não frases genéricas que poderiam servir a qualquer história.
- O prompt de imagem descreve um único quadro-chave coerente, sem pedir texto, legendas ou logotipos.
- O prompt de vídeo descreve movimento que realmente pode ser animado, não apenas movimento de câmera.

ENTREGUE SOMENTE JSON VÁLIDO, sem Markdown, exatamente nesta estrutura:
{{
  "title": "título curto, original e evocativo",
  "premise": "sinopse de 2 a 4 frases com protagonista, objetivo, conflito e diferencial da história",
  "continuityRules": ["regras concretas de aparência, objetos, cenário e continuidade"],
  "scenes": [
    {{
      "title": "Cena 1 — título específico e cinematográfico",
      "purpose": "o que muda na história nesta cena e por que ela é necessária",
      "action": "ação visual específica, com personagem, espaço, gesto, objeto e consequência",
      "dialogue": "fala curta e natural em português brasileiro ou string vazia",
      "shot": "plano e enquadramento adequados à ação",
      "camera": "movimento de câmera motivado pela emoção ou ação",
      "lighting": "luz e atmosfera coerentes com o momento",
      "imagePrompt": "quadro-chave completo em português, descrevendo personagem, ação, cenário, composição e estilo",
      "videoPrompt": "movimento corporal e facial, interação com objetos, movimento do ambiente e câmera; preservar identidade"
    }}
  ]
}}

CONTROLE DE QUALIDADE ANTES DE RESPONDER
- Leia mentalmente as cenas em sequência: há começo, progressão, virada, clímax e conclusão?
- Se eu trocar a ideia do usuário por qualquer outra, as cenas ainda serviriam? Se sim, estão genéricas: reescreva.
- Cada cena acrescenta informação, consequência ou emoção nova? Remova cenas repetitivas.
- A reviravolta foi preparada por pistas? O final recompensa a atenção do público?
- As falas soam como pessoas reais e diferentes entre si?
- Os prompts descrevem exatamente o que acontece na ação, sem contradizer a história?
- Preserve o núcleo da ideia do usuário e a identidade visual do personagem em todas as cenas.
""".strip()

    request_body = {
        "model": STORY_MODEL,
        "temperature": 0.95,
        "max_tokens": 16000,
        "response_format": {"type": "json_object"},
        "plugins": [{"id": "response-healing"}],
        "messages": [
            {"role": "system", "content": "Você é um roteirista-chefe de animação, inventivo, exigente e cinematográfico. Nunca entregue texto genérico; cumpra as regras criativas e de qualidade do briefing."},
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
            "HTTP-Referer": "https://rafaproerd-cpu.github.io/estudio-animacao-2d/",
            "X-Title": "Estudio 2D",
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
