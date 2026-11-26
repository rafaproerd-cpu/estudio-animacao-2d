# Estúdio 2D

Aplicativo mobile-first em Expo/React Native para uso pessoal no iPhone e Android. A prévia web é hospedada no GitHub Pages; ela não hospeda modelos de IA.

## O que funciona no aplicativo
- Criar projetos a partir de uma ideia, gênero e duração.
- Organizar histórias em quantidade variável de cenas.
- Editar ficha fixa de personagem, ações, diálogos e prompts visuais.
- Ajustar enquadramento, câmera e iluminação por cena.
- Salvar projetos no aparelho e copiar/compartilhar roteiros e prompts.

## Estado real da geração

A interface de criação de roteiro e cenas funciona no navegador e no aplicativo. A organização da história ainda usa um planejador local baseado em modelos; não é uma IA generativa. Os botões de imagem e vídeo já chamam os adaptadores HTTP do backend, mas **a geração real ainda não foi validada de ponta a ponta**.

- **Imagem:** há dois caminhos preparados: SDXL local em uma máquina com GPU CUDA compatível ou um Space Gradio no Hugging Face ZeroGPU. O segundo caminho permite que o Render chame o Space sem ter GPU própria, mas depende da elegibilidade, fila e cota diária do Hugging Face. O Space de teste foi atualizado para produzir imagens horizontais 16:9 (768×432), sem imagem de referência e sem garantia de consistência de personagem.
- **Vídeo:** o adaptador experimental Wan2.2 TI2V 5B está preparado, mas precisa de runtime, pesos e GPU compatível. O caminho gratuito de imagem via ZeroGPU não gera vídeo.
- **Voz:** Piper local é opcional e depende do executável e de modelos de voz licenciados.
- **Montagem:** FFmpeg concatena clipes enviados e pode mixar narração/música; isso não substitui a geração dos clipes.

Nenhuma inferência real de imagem ou vídeo foi executada ainda. A prévia GitHub Pages é somente a interface; ela não hospeda modelos nem gera mídia sozinha. Para testar imagens, ainda é necessário publicar o Space Hugging Face e configurar o backend Render com `HF_SPACE_ID` (e `HF_TOKEN` somente se o Space for privado), depois conectar a URL HTTPS e o token do Render no aplicativo.

## Modelos e requisitos
- **Imagem:** SDXL 1.0 Base; precisa de PyTorch/CUDA e Diffusers, além de GPU compatível. O backend agora aceita uma imagem de referência PNG/JPEG em Base64 via SDXL image-to-image; o app reutiliza a primeira cena como referência para cenas seguintes. A consistência visual ainda precisa ser validada em uma inferência real.
- **Vídeo:** Wan2.2 TI2V 5B; o model card oficial informa Apache 2.0, geração texto+imagem para vídeo, 24 FPS e GPU com pelo menos 24 GB de VRAM na configuração descrita. O backend usa o CLI oficial, pois o model card informa requisitos específicos para a versão Diffusers.

Referências oficiais:
- SDXL: https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0
- Wan2.2 TI2V 5B: https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B
- Código CLI oficial Wan2.2: https://github.com/Wan-Video/Wan2.2/blob/main/generate.py

## Publicar e conectar o backend

O repositório inclui um `render.yaml` para iniciar a configuração pelo Render usando **New → Blueprint** e conectando este repositório. O plano gratuito pode suspender o serviço por inatividade e usa armazenamento efêmero; não trate os arquivos gerados como permanentes. O Blueprint cria `ESTUDIO_RENDER_TOKEN` e solicita `HF_SPACE_ID` e `HF_TOKEN` como variáveis de ambiente.

Para habilitar a geração remota de imagens:
1. Crie um Space Gradio com ZeroGPU na sua conta Hugging Face.
2. Publique `huggingface-space/app.py` e `huggingface-space/requirements.txt` na raiz desse Space.
3. Configure `HF_SPACE_ID=usuario/nome-do-space` no serviço Render. Só configure `HF_TOKEN` no Render se o Space for privado; nunca coloque esse segredo no aplicativo.
4. Depois que o Render estiver ativo, copie a URL HTTPS do serviço e o valor de `ESTUDIO_RENDER_TOKEN`.
5. Na prévia, abra **Conectar motor do Estúdio 2D**, informe a URL e o token, salve e teste a conexão.

O Space gratuito tem cota diária limitada e a primeira geração pode falhar por fila, elegibilidade ou limite de uso. A conexão da API, por si só, não comprova que o modelo gerou uma imagem; é necessário concluir uma geração de teste.

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
