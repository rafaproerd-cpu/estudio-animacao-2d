# Servidor de montagem do Estúdio 2D

Este serviço opcional transforma os clipes gerados no app em um único MP4. Ele deve rodar na mesma máquina/rede do servidor ComfyUI, ou em outra máquina com acesso ao iPhone e espaço suficiente.

## Requisitos

- Python 3.10 ou superior
- FFmpeg instalado e disponível no PATH
- Piper instalado no servidor (opcional, para voz local) e modelos de voz `.onnx` licenciados para uso
- Rede privada/VPN; não exponha este serviço diretamente à internet pública

## Imagem de contêiner (Docker)

O repositório inclui um Dockerfile para empacotar a API e o FFmpeg juntos. Isso facilita hospedar o serviço em uma máquina compatível com Docker; **não cria uma hospedagem gratuita automaticamente** e não inclui modelos de voz.

Na raiz do repositório:

```bash
docker build -t estudio2d-render ./render-server
docker run --detach --name estudio2d-render \
  --publish 8765:8765 \
  --env ESTUDIO_RENDER_TOKEN="gere-um-token-longo" \
  --volume estudio2d-data:/data \
  estudio2d-render
```

Os arquivos MP4 ficam no volume persistente `/data/outputs`. Para ativar Piper dentro do contêiner, instale o pacote Piper compatível e coloque os modelos de voz licenciados em `/data/voices`; sem o executável e os modelos, a geração de voz permanece indisponível. Não exponha a porta publicamente sem HTTPS e uma camada de proteção.

## Instalação manual

```bash
cd render-server
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate
pip install -r requirements.txt
```

Gere um token longo e aleatório (por exemplo, `python -c "import secrets; print(secrets.token_urlsafe(32))"`) e configure a variável de ambiente `ESTUDIO_RENDER_TOKEN`.

Windows PowerShell:
```powershell
$env:ESTUDIO_RENDER_TOKEN="coloque-seu-token-longo-aqui"
uvicorn main:app --host 0.0.0.0 --port 8765
```

macOS/Linux:
```bash
export ESTUDIO_RENDER_TOKEN="coloque-seu-token-longo-aqui"
uvicorn main:app --host 0.0.0.0 --port 8765
```

O app deve usar `http://IP-DA-MAQUINA:8765` em rede local, ou um endereço HTTPS protegido por VPN/reverse proxy. O endpoint `/health` exige o mesmo token Bearer e permite verificar se o FFmpeg foi encontrado. O endpoint `GET /v1/capabilities` (também protegido pelo token) informa quais motores estão realmente instalados; no estado atual, imagem e vídeo aparecem como indisponíveis, enquanto voz depende do executável Piper e de modelos `.onnx`. O endpoint `POST /render` exige `Authorization: Bearer TOKEN` e recebe vários arquivos no campo multipart `clips`, na ordem desejada. O serviço normaliza resolução para 1024×576, 30 FPS e H.264, concatena os segmentos e retorna uma URL para baixar o MP4. Também aceita narração e música opcionais e faz a mixagem no MP4 final.

## Voz por IA local (Piper)

A geração de voz não usa API paga nem créditos externos: quando o Piper está instalado no mesmo servidor, o serviço pode sintetizar texto localmente. Configure `PIPER_PATH` se o executável não estiver no PATH e `PIPER_VOICES_DIR` se os modelos estiverem em outra pasta. Por padrão, os modelos `.onnx` ficam em `render-server/voices/`. Coloque nessa pasta apenas modelos Piper e arquivos de configuração correspondentes obtidos de uma fonte confiável, respeitando a licença de cada voz.

- `GET /tts/voices` lista os modelos `.onnx` disponíveis (requer Bearer token).
- `POST /tts` recebe JSON com `text` e `voice` (nome do modelo sem `.onnx`) e devolve WAV.
- `POST /tts/batch` recebe `segments`, uma lista ordenada de `{ "text": "...", "voice": "nome-do-modelo", "duration_seconds": 4 }`; gera cada fala com sua voz, ajusta o áudio ao tempo da cena e preenche cenas sem diálogo com silêncio. O campo `duration_seconds` aceita de 0,5 a 60 segundos e assume 4 segundos quando omitido.
- O texto tem limite padrão de 6.000 caracteres; a geração tem timeout de 3 minutos.
- Sem Piper ou sem um modelo instalado, o endpoint informa claramente que a função não está disponível; não usa um serviço pago como fallback.

Exemplo de variáveis opcionais:
```bash
PIPER_PATH=piper
PIPER_VOICES_DIR=./voices
MAX_TTS_CHARACTERS=6000
```

## Limites atuais

- A montagem concatena os clipes em sequência; transições e efeitos ainda não estão implementados.
- O áudio original dos clipes é removido durante a normalização. Narração e música enviadas separadamente são mixadas no MP4 final.
- A geração de voz por Piper funciona apenas quando o executável e os modelos `.onnx` estão instalados no servidor.
- Cada clipe/arquivo de áudio tem limite padrão de 500 MB e cada montagem aceita até 80 clipes.
- Os MP4 e WAV finais ficam em `RENDER_OUTPUT_DIR` (por padrão `outputs/`; no Docker, `/data/outputs`). Proteja o disco e faça limpeza periódica dos arquivos.
- O token protege os endpoints, mas não substitui HTTPS/VPN. Não use uma porta pública sem uma camada de segurança.


## Estado dos motores integrados

O endpoint `GET /v1/capabilities` é a fonte de verdade sobre os recursos instalados. Ele não marca imagem ou vídeo como disponíveis só porque o app possui adaptadores HTTP: os modelos precisam estar instalados e conectados no backend. Neste momento, a API informa imagem e vídeo como `not_configured`. Isso evita que a interface prometa uma geração que o servidor ainda não consegue executar.


### Endpoints de geração de imagem e vídeo

Os endpoints `POST /v1/generations/images` e `POST /v1/generations/videos` já existem como respostas explícitas de indisponibilidade: ambos exigem token e retornam HTTP 503 enquanto não houver um modelo real instalado. Consulte `GET /v1/capabilities` para verificar os recursos disponíveis. Eles não criam jobs fictícios nem simulam progresso.
