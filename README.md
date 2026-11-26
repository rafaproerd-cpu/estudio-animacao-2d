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
- endpoints de geração de imagem e vídeo que retornam HTTP 503 até que modelos reais sejam instalados.

O backend ainda não está hospedado nem conectado à prévia web. Não existe fila real de geração de imagem/vídeo ativa. O Piper e os modelos de voz também não estão instalados no ambiente publicado. A prévia GitHub Pages hospeda apenas a interface.

## Modelos em avaliação — ainda não instalados
- **Imagem:** SDXL 1.0 Base, sujeito a testes de qualidade, consistência de personagem e licença.
- **Vídeo:** Wan2.2 TI2V 5B, candidato principal para texto/imagem-para-vídeo. O model card oficial indica Apache 2.0 e execução com GPU de pelo menos 24 GB de VRAM para a configuração descrita. O resultado visual no estilo 2D/anime ainda precisa ser testado.

Nenhum desses modelos foi baixado ou ativado no servidor. A escolha final depende de teste real de qualidade, velocidade, memória e compatibilidade.

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
