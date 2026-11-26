# Estúdio 2D

Aplicativo mobile-first em Expo/React Native, pensado para uso pessoal no iPhone e Android e acesso por uma prévia web.

## O que funciona no aplicativo
- Criar projetos a partir de uma ideia, gênero e duração.
- Organizar a história em uma quantidade variável de cenas.
- Editar a ficha fixa do personagem, ações, diálogos e prompts visuais.
- Ajustar enquadramento, movimento de câmera e iluminação de cada cena.
- Salvar projetos automaticamente no aparelho.
- Copiar e compartilhar roteiros e prompts.

## O que ainda está em desenvolvimento
- Geração própria de imagens por IA.
- Animação de imagens em clipes de vídeo por IA.
- Vozes geradas automaticamente e sincronização labial.
- Fila de produção com progresso e retomada.
- Montagem integrada das cenas em MP4, com transições e áudio.

Os controles de geração de mídia aparecem desativados até que o motor integrado esteja realmente instalado e conectado. O aplicativo não deve exigir que o usuário configure ComfyUI, workflows, IDs de nós ou plugins.

## Estado real do backend
Existe um serviço FastAPI com:
- montagem de clipes enviados pelo usuário usando FFmpeg;
- mixagem opcional de narração e música;
- integração opcional com Piper para síntese local de voz, caso o executável e os modelos de voz estejam instalados;
- endpoint autenticado `GET /v1/capabilities`, que informa recursos realmente detectados e diagnóstico básico de GPUs NVIDIA;
- endpoint de geração SDXL texto-para-imagem com fila em segundo plano, status de job e links privados de download com expiração; só é ativado quando modelo, Diffusers, PyTorch e dispositivo compatível estiverem configurados;
- endpoint de animação de vídeo que continua retornando HTTP 503 até que o modelo Wan seja integrado e validado.

O backend ainda não está hospedado nem conectado à prévia web. A fila de imagem foi implementada, mas permanece inativa sem modelo SDXL e runtime PyTorch/Diffusers em GPU; ainda não foi feita uma inferência real. A fila é mantida em memória e jobs se perdem se o processo reiniciar. A geração de vídeo ainda não está implementada. O Piper e os modelos de voz também não estão instalados no ambiente publicado. A prévia GitHub Pages hospeda apenas a interface.

## Modelos em avaliação — ainda não instalados
- **Imagem:** SDXL 1.0 Base, sujeito a testes de qualidade, consistência de personagem e licença.
- **Vídeo:** Wan2.2 TI2V 5B, candidato principal para texto/imagem-para-vídeo. O model card oficial indica Apache 2.0 e execução com GPU de pelo menos 24 GB de VRAM para a configuração descrita. O resultado visual no estilo 2D/anime ainda precisa ser testado.

Nenhum desses modelos foi baixado ou ativado no servidor. A escolha final depende de teste real de qualidade, velocidade, memória e compatibilidade.

### Ativar o motor opcional de imagem em uma máquina GPU

1. Instale uma versão do PyTorch compatível com a versão CUDA do host, usando o seletor oficial do PyTorch.
2. Instale as dependências adicionais com `pip install -r render-server/requirements-image.txt`.
3. Baixe/prepare o checkpoint SDXL em armazenamento persistente ou configure `IMAGE_MODEL_ID` com o ID do repositório Hugging Face.
4. Configure `IMAGE_DEVICE=cuda`, `IMAGE_MODEL_ID` e `RENDER_OUTPUT_DIR`/`IMAGE_OUTPUT_DIR`; mantenha o token de API configurado.
5. Consulte `GET /v1/capabilities` antes de enviar uma imagem. O primeiro carregamento pode baixar pesos e levar vários minutos.

O motor inicial é apenas texto-para-imagem: referências visuais de personagens são recusadas explicitamente até a etapa image-to-image. A fila e os estados são em memória, adequados ao protótipo de uma única instância, não a uma implantação escalável.

### Ativar o motor experimental de vídeo Wan2.2

1. Clone o repositório oficial `https://github.com/Wan-Video/Wan2.2` em uma máquina Linux com GPU NVIDIA.
2. Instale PyTorch/CUDA compatíveis e as dependências oficiais desse repositório; a documentação do modelo pede PyTorch 2.4 ou superior.
3. Baixe os pesos oficiais `Wan-AI/Wan2.2-TI2V-5B` para um diretório persistente.
4. Configure `WAN_GENERATE_SCRIPT`, `WAN_CHECKPOINT_DIR`, `WAN_PYTHON` e `WAN_SIZE=1280*704`. O backend verifica a GPU e exige aproximadamente 24 GB livres.
5. O endpoint recebe `imageBase64` (PNG/JPEG) e prompt. O primeiro fluxo gera cerca de 4 segundos a 24 FPS.

O adaptador usa o `generate.py` oficial em subprocesso, sem shell, e valida o MP4 de saída. Ainda precisa de uma inferência real de ponta a ponta antes de ser considerado pronto.

## Custos e infraestrutura
Pesos de modelos abertos podem ser usados sem pagar créditos por chamada de API, respeitando suas licenças. Isso **não** torna a geração ilimitada gratuita: inferência de vídeo exige GPU, energia, armazenamento e hospedagem. O iPhone é a interface de controle; os modelos pesados precisam executar em hardware compatível. Não prometemos geração gratuita ilimitada na nuvem.

## Prévia
https://rafaproerd-cpu.github.io/estudio-animacao-2d/

A prévia é uma versão de desenvolvimento e não comprova que a geração de mídia esteja ativa.

## Desenvolvimento
```bash
npm install
npx expo start
npm run typecheck
```

O projeto usa Expo SDK 54, React Native 0.81 e TypeScript. O GitHub Actions valida a configuração Expo, os tipos, a exportação web, os testes do servidor e a construção do container.

## Próximas etapas
1. Validar o novo texto da interface e manter os controles indisponíveis até integração real.
2. Escolher e testar a GPU/infraestrutura de inferência.
3. Instalar e testar o modelo de imagem e o modelo de vídeo image-to-video.
4. Implementar fila real de jobs, progresso, falhas e retomada.
5. Conectar o app ao backend integrado sem exigir configuração técnica do usuário.
6. Testar o fluxo completo no iPhone: ideia → cenas → imagens → clipes → voz → MP4.
