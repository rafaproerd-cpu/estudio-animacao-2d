# Servidor de montagem do Estúdio 2D

Este serviço é o backend próprio do Estúdio 2D: recebe pedidos do app, executa os motores locais de imagem/vídeo quando configurados e também monta clipes em MP4. Ele deve rodar em uma máquina com recursos compatíveis e acesso HTTPS seguro.

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

O app usa o endereço HTTPS público protegido do backend. Configure `ESTUDIO_ALLOWED_ORIGINS` com a origem do app web (por exemplo `https://rafaproerd-cpu.github.io`) para permitir chamadas do navegador; o padrão `*` é amplo e deve ser restringido em produção. O endpoint `/health` exige o mesmo token Bearer e permite verificar se o FFmpeg foi encontrado. O endpoint `GET /v1/capabilities` (também protegido pelo token) informa quais motores estão realmente instalados; imagem e vídeo só aparecem como disponíveis quando seus runtimes, pesos e GPU estão configurados; voz depende do executável Piper e de modelos `.onnx`. O endpoint `POST /render` exige `Authorization: Bearer TOKEN` e recebe vários arquivos no campo multipart `clips`, na ordem desejada. O serviço normaliza resolução para 1024×576, 30 FPS e H.264, concatena os segmentos e retorna uma URL para baixar o MP4. Links privados de arquivos gerados expiram após sete dias por padrão (`GENERATION_DOWNLOAD_TTL_SECONDS`). Também aceita narração e música opcionais e faz a mixagem no MP4 final.

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

## Motor opcional de imagem SDXL

A API inclui um primeiro motor de texto-para-imagem baseado em Diffusers. Ele fica desativado por padrão e só aparece como disponível quando o checkpoint, PyTorch, Diffusers e a GPU configurada estão prontos.

Em uma máquina Linux com GPU NVIDIA e driver/CUDA compatíveis:

1. Instale PyTorch usando o seletor oficial para a versão CUDA da máquina: https://pytorch.org/get-started/locally/
2. Instale a camada adicional: `pip install -r requirements-image.txt`.
3. Configure `IMAGE_MODEL_ID=stabilityai/stable-diffusion-xl-base-1.0` (ou o caminho de um checkpoint SDXL local) e `IMAGE_DEVICE=cuda`.
4. Ajuste `IMAGE_MIN_FREE_VRAM_MB` se necessário; o padrão é 8.000 MB livres. O motor recusa iniciar quando a memória disponível fica abaixo desse limite.
5. Mantenha `ESTUDIO_RENDER_TOKEN` configurado e consulte `GET /v1/capabilities`.

O primeiro carregamento pode baixar vários GB de pesos. O Dockerfile padrão não instala PyTorch/CUDA nem pesos de modelos; a camada de inferência é opcional para evitar uma imagem básica enorme. Se executar em Docker, prepare uma imagem derivada com PyTorch compatível e passe a GPU NVIDIA ao container.

- `POST /v1/generations/images` recebe `prompt`, `negativePrompt`, `width`, `height`, `seed` e, opcionalmente, `referenceImageBase64` (PNG/JPEG), e devolve `job_id`.
- `GET /v1/jobs/{job_id}` consulta o estado; o resultado contém um link temporário privado para o PNG.
- A fila é em memória, com uma tarefa ativa por padrão; reiniciar o processo perde o histórico dos jobs.
- O motor suporta texto-para-imagem e image-to-image com referência PNG/JPEG em Base64 (`referenceImageBase64`). A UI pode reutilizar a primeira imagem como referência das cenas seguintes; o pipeline troca entre SDXL txt2img e img2img, mantendo apenas um carregado por vez.
- O motor Wan2.2 é opcional e exige o runtime oficial, pesos e aproximadamente 23 GB de VRAM livre; sem isso, `POST /v1/generations/videos` retorna HTTP 503.

## Geração remota de imagens via Hugging Face ZeroGPU

Como alternativa ao SDXL instalado em uma GPU própria, o servidor pode chamar um Space Gradio configurado com ZeroGPU. Isso não hospeda o backend automaticamente e depende de um Space criado na conta Hugging Face do usuário, da fila e da cota de GPU dessa conta.

1. Crie um Space Gradio com ZeroGPU e publique os arquivos de `huggingface-space/` deste repositório.
2. No ambiente do servidor de renderização, configure `HF_SPACE_ID=seu-usuario/seu-space`.
3. Para Space privado, configure também `HF_TOKEN` como segredo do servidor. Nunca coloque esse token no aplicativo ou no código público.
4. Instale `render-server/requirements.txt` e consulte `GET /v1/capabilities`.

Quando o SDXL local não estiver pronto, o backend tentará usar o Space remoto. O protótipo atual gera imagens quadradas de 512×512 e não recebe imagem de referência, não mantém identidade de personagens por conta própria e não gera vídeo. O status `configured_unverified` significa que as configurações existem; somente uma chamada real confirma que o Space está acordado, autorizado e com cota disponível.

Exemplo de variáveis:
```bash
HF_SPACE_ID=seu-usuario/seu-space
HF_TOKEN=
```

## Motor experimental de vídeo Wan2.2 TI2V 5B

O adaptador opcional usa o CLI oficial do projeto Wan2.2. O checkpoint TI2V 5B suporta texto+imagem para vídeo, 720p a 24 FPS e a configuração oficial de uma GPU requer pelo menos 24 GB de VRAM. O backend chama o script oficial `generate.py`, sem shell.

Instalação em uma máquina GPU:
1. Clone `https://github.com/Wan-Video/Wan2.2`.
2. Instale PyTorch/CUDA compatíveis e as dependências oficiais do repositório (PyTorch 2.4 ou superior).
3. Baixe `Wan-AI/Wan2.2-TI2V-5B` para um diretório persistente.
4. Configure `WAN_GENERATE_SCRIPT` para o `generate.py` clonado, `WAN_CHECKPOINT_DIR` para os pesos, `WAN_PYTHON` para o Python desse ambiente e `WAN_SIZE=1280*704`.
5. O backend verifica CUDA e cerca de 23 GB de VRAM livre (margem aproximada para a configuração de 24 GB) antes de aceitar jobs.

O endpoint recebe `prompt`, `imageBase64` (PNG/JPEG), `durationSeconds` de 1 a 5 e `seed`. O backend escolhe um número de frames 4n+1 a 24 FPS, executa o CLI e retorna um link temporário protegido. Nenhum modelo foi instalado nem testado no ambiente publicado.

## Limites atuais

- A montagem concatena os clipes em sequência; transições e efeitos ainda não estão implementados.
- O áudio original dos clipes é removido durante a normalização. Narração e música enviadas separadamente são mixadas no MP4 final.
- A geração de voz por Piper funciona apenas quando o executável e os modelos `.onnx` estão instalados no servidor.
- Cada clipe/arquivo de áudio tem limite padrão de 500 MB e cada montagem aceita até 80 clipes.
- Os MP4 e WAV finais ficam em `RENDER_OUTPUT_DIR` (por padrão `outputs/`; no Docker, `/data/outputs`). Proteja o disco e faça limpeza periódica dos arquivos.
- O token protege os endpoints, mas não substitui HTTPS/VPN. Não use uma porta pública sem uma camada de segurança.


## Estado dos motores integrados

O endpoint `GET /v1/capabilities` é a fonte de verdade sobre os recursos instalados. O motor de imagem informa se SDXL local está pronto ou se há um Space Hugging Face remoto configurado; um Space configurado ainda precisa ser testado por uma chamada real. O motor de vídeo só aparece como `ready` quando o CLI oficial do Wan2.2, checkpoint, PyTorch/CUDA e memória livre suficiente estão configurados.


### Endpoints de geração de imagem e vídeo

`POST /v1/generations/images` cria uma tarefa real quando SDXL local ou um Space Hugging Face remoto está configurado; a disponibilidade remota depende da fila e da cota do Space. `GET /v1/jobs/{job_id}` devolve o estado e o link de saída. `POST /v1/generations/videos` cria um job Wan2.2 TI2V quando o runtime está pronto; caso contrário, retorna HTTP 503. Consulte `GET /v1/capabilities` antes de iniciar uma geração.


## Implantação guiada no Render

O arquivo `render.yaml` na raiz do repositório permite iniciar a implantação do backend pelo fluxo **New + Blueprint** do Render:

1. Entre no Render e escolha **New + Blueprint**.
2. Conecte o repositório `rafaproerd-cpu/estudio-animacao-2d` e confirme a implantação.
3. O Render cria o serviço Docker, gera `ESTUDIO_RENDER_TOKEN` e solicita os valores opcionais `HF_SPACE_ID` e `HF_TOKEN`.
4. Depois que o serviço ficar disponível, copie o endereço HTTPS e o valor de `ESTUDIO_RENDER_TOKEN` para a opção **Conectar motor** no app.

O endpoint público `/healthz` é somente um sinal mínimo para o health check da hospedagem. Os endpoints de geração, capacidades, montagem e o endpoint detalhado `/health` continuam protegidos por Bearer token.

**Limites do plano gratuito:** o serviço pode dormir após inatividade, não oferece GPU para executar SDXL/Wan2.2 e não inclui disco persistente. Para gerar imagens, ainda é necessário configurar um Space ZeroGPU próprio e informar seu ID em `HF_SPACE_ID`; o token Hugging Face, se necessário, deve ficar somente nos segredos do Render. A implantação do backend, por si só, não ativa geração de imagem nem vídeo. O plano gratuito também não é adequado para guardar permanentemente arquivos de projetos e resultados.
