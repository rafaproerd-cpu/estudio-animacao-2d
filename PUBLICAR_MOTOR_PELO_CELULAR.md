# Publicar o motor do Estúdio 2D pelo celular

Este guia ativa o backend do Estúdio 2D. A prévia web pode funcionar sem esta etapa; gerar imagens reais exige publicar o servidor e conectar um Space do Hugging Face.

## 1. Criar o Space de imagens

1. Entre em https://huggingface.co/spaces pelo navegador do iPhone.
2. Toque em **Create new Space**.
3. Nome sugerido: `estudio-2d-imagens`.
4. Escolha **Gradio** como SDK e **ZeroGPU** como hardware, se estiver disponível na sua conta.
5. Crie o Space.
6. Envie para a raiz do Space os arquivos `app.py`, `requirements.txt` e `README.md` que estão na pasta `huggingface-space` deste repositório.
7. Aguarde a instalação e o estado **Running**. Faça um teste de imagem no próprio Space.

A cota ZeroGPU gratuita é limitada e depende da elegibilidade da conta e da fila. O primeiro motor gera imagens 16:9; ainda não gera vídeo nem mantém sozinho a aparência do personagem entre cenas.

**Importante sobre vídeos:** publicar o Space de imagens e o servidor Render não ativa o Wan2.2. No servidor sem GPU CUDA compatível, o Estúdio só consegue criar clipes com movimento de câmera sobre imagens estáticas. A animação real de personagens por IA exige um trabalhador de vídeo separado com GPU compatível e integração própria; essa etapa ainda não está publicada nem validada. Não contrate um plano pago nem altere configurações de GPU por causa deste guia.

## 2. Publicar o servidor no Render

1. Entre em https://dashboard.render.com/.
2. Escolha **New** → **Blueprint**.
3. Conecte o GitHub e selecione o repositório `rafaproerd-cpu/estudio-animacao-2d`.
4. O Render deve localizar o arquivo `render.yaml` e mostrar o serviço `estudio-2d-render`.
5. Antes de criar o serviço, preencha `HF_SPACE_ID` com o identificador do Space no formato `seu-usuario/estudio-2d-imagens`.
6. Se o Space for público, `HF_TOKEN` pode ficar vazio. Se for privado, crie um token Hugging Face com permissão de leitura e guarde-o somente como secret no Render.
7. Deixe `STORY_API_URL`, `STORY_API_KEY` e `STORY_MODEL` vazios por enquanto. São opcionais e usados para roteiro original por modelo de linguagem.
8. Crie o Blueprint e aguarde o deploy terminar. O Render gera `ESTUDIO_RENDER_TOKEN) automaticamente pelo `render.yaml`; não publique nem compartilhe esse valor.

**Atenção:** o plano gratuito pode suspender o serviço quando fica sem uso e o disco local pode ser efêmero. Não há garantia de geração gratuita ilimitada.

## 3. Conectar no aplicativo

1. Abra a prévia do Estúdio 2D.
2. Toque em **Conectar motor do Estúdio 2D**.
3. No Render, abra o serviço `estudio-2d-render` e copie a URL pública HTTPS (termina em `.onrender.com`).
4. No Render, abra **Environment** e copie o valor de `ESTUDIO_RENDER_TOKEN` com cuidado.
5. Cole a URL e o token nos campos do aplicativo, toque em **Salvar conexão** e depois em **Testar conexão do motor**.

Não envie o token em conversas, prints ou repositórios. Ele é uma senha de acesso ao seu servidor.

## O que confirma que está funcionando

- O teste de conexão confirma apenas que o app alcança o servidor e que o token foi aceito.
- O teste de imagem só estará confirmado depois de uma solicitação real gerar e devolver um PNG.
- O modo de vídeo sem Wan2.2 cria movimento de câmera sobre uma imagem estática; não é movimento de personagem gerado por IA.
