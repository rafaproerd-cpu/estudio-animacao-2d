# Estúdio 2D

Aplicativo mobile-first em Expo/React Native para uso pessoal no iPhone e Android. A prévia web é hospedada no GitHub Pages; ela não hospeda modelos de IA.

## O que funciona no aplicativo
- Criar projetos a partir de uma ideia, gênero e duração.
- Organizar histórias em quantidade variável de cenas.
- Editar ficha fixa de personagem, ações, diálogos e prompts visuais.
- Ajustar enquadramento, câmera e iluminação por cena.
- Salvar projetos no aparelho e copiar/compartilhar roteiros e prompts.

## Estado real da geração
A interface já tem os controles de geração de imagem por cena/em lote e animação por cena/em lote conectados aos adaptadores HTTP próprios do Estúdio 2D. O usuário informa apenas o endereço HTTPS e o token do backend; não configura ComfyUI, workflows ou plugins. Os controles só funcionarão depois que o backend com os modelos e GPU for hospedado.

O backend FastAPI tem agora os primeiros adaptadores reais preparados:
- **Imagem:** SDXL texto-para-imagem via Diffusers, carregado sob demanda, com verificação de CUDA/VRAM, fila em memória, consulta de job e link privado temporário.
- **Vídeo:** Wan2.2 TI2V 5B via `generate.py` oficial, com entrada de imagem PNG/JPEG em Base64, prompt, duração de 1–5 segundos, fila e link privado temporário. O runtime oficial, pesos e GPU precisam estar instalados.
- **Renderização:** FFmpeg concatena clipes enviados e mixa narração/música.
- **Voz:** Piper local é opcional e só funciona com executável e modelos `.onnx` instalados.

**Nenhuma inferência de imagem ou vídeo foi executada ainda.** Os modelos não foram baixados e o backend não está hospedado nem conectado à prévia. As filas atuais são voláteis: reiniciar o processo apaga o estado dos jobs. O ambiente publicado não tem GPU, pesos SDXL/Wan ou Piper. A prévia GitHub Pages é somente a interface; não gera mídia sozinha.

## Modelos e requisitos
- **Imagem:** SDXL 1.0 Base; precisa de PyTorch/CUDA e Diffusers, além de GPU compatível. O backend agora aceita uma imagem de referência PNG/JPEG em Base64 via SDXL image-to-image; o app reutiliza a primeira cena como referência para cenas seguintes. A consistência visual ainda precisa ser validada em uma inferência real.
- **Vídeo:** Wan2.2 TI2V 5B; o model card oficial informa Apache 2.0, geração texto+imagem para vídeo, 24 FPS e GPU com pelo menos 24 GB de VRAM na configuração descrita. O backend usa o CLI oficial, pois o model card informa requisitos específicos para a versão Diffusers.

Referências oficiais:
- SDXL: https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0
- Wan2.2 TI2V 5B: https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B
- Código CLI oficial Wan2.2: https://github.com/Wan-Video/Wan2.2/blob/main/generate.py

## Conectar o aplicativo ao backend

Na prévia, abra **Conectar motor do Estúdio 2D**, informe a URL HTTPS e o token privado do backend e teste a conexão. O token é armazenado no SecureStore do aparelho. Configure `ESTUDIO_ALLOWED_ORIGINS` no backend com a origem web autorizada.

## Ativar o motor opcional de imagem
1. Instale PyTorch compatível com o driver/CUDA da máquina, usando o seletor oficial: https://pytorch.org/get-started/locally/
2. Instale `pip install -r render-server/requirements-image.txt`.
3. Configure `IMAGE_MODEL_ID=stabilityai/stable-diffusion-xl-base-1.0` ou um checkpoint local, `IMAGE_DEVICE=cuda` e o diretório persistente de saída.
4. Configure `ESTUDIO_RENDER_TOKEN` e consulte `GET /v1/capabilities`.
5. O primeiro carregamento pode baixar vários GB de pesos. A API recusa gerar se a VRAM livre estiver abaixo do limite configurado (8 GB por padrão).

## Ativar o motor experimental de vídeo
1. Clone `https://github.com/Wan-Video/Wan2.2` em uma máquina Linux com GPU NVIDIA.
2. Instale PyTorch/CUDA compatíveis e as dependências oficiais do repositório (PyTorch 2.4 ou superior).
3. Baixe `Wan-AI/Wan2.2-TI2V-5B` para armazenamento persistente.
4. Configure `WAN_GENERATE_SCRIPT`, `WAN_CHECKPOINT_DIR`, `WAN_PYTHON` e `WAN_SIZE=1280*704`.
5. A API verifica CUDA e uma margem de aproximadamente 23 GB de VRAM livre antes de aceitar jobs.

O endpoint de vídeo recebe `imageBase64` (PNG/JPEG) e prompt. O CLI oficial salva um MP4 a 24 FPS. O adaptador é experimental e precisa de uma inferência real ponta a ponta antes de ser considerado pronto.

## Custos e infraestrutura
Pesos abertos podem ser usados sem pagar créditos por chamada de API, respeitando as licenças. Isso **não** torna a geração ilimitada gratuita: inferência de vídeo exige GPU, energia, armazenamento e hospedagem. O iPhone é a interface de controle; os modelos pesados precisam executar em hardware compatível. Não prometemos geração gratuita ilimitada na nuvem.

## Prévia
https://rafaproerd-cpu.github.io/estudio-animacao-2d/

## Desenvolvimento
```bash
npm install
npx expo start
npm run typecheck
```

O GitHub Actions valida Expo, TypeScript, exportação web, testes do servidor e construção do container.
