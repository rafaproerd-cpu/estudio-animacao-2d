---
title: Estudio 2D Image Test
emoji: 🎬
colorFrom: purple
colorTo: blue
sdk: gradio
sdk_version: 5.49.1
app_file: app.py
pinned: false
---

# Estúdio 2D — teste de imagem

Este Space é um protótipo de prova de conceito para gerar uma imagem com SDXL Turbo usando ZeroGPU.

## O que ele faz
- Recebe uma descrição curta de cena.
- Gera uma imagem 512×512 com quatro passos de inferência.
- Expõe a função Gradio com o nome de API generate, para futura conexão com o servidor do Estúdio 2D.

## Publicação
1. Crie um Space novo no Hugging Face.
2. Escolha Gradio como SDK e ZeroGPU como hardware, se essa opção estiver disponível na conta.
3. Envie os arquivos desta pasta (app.py e requirements.txt) para a raiz do Space.
4. Aguarde o Space instalar as dependências e iniciar.
5. Teste uma descrição no próprio Space.

Não coloque tokens privados nos arquivos. Para contas gratuitas, a cota diária do ZeroGPU é limitada e a fila pode variar.

## Limitações
- Este é apenas o primeiro teste de imagem, não gera vídeo.
- O modelo é SDXL Turbo; consistência de personagem entre cenas ainda não está implementada.
- O projeto ainda não está conectado automaticamente a um Space publicado.
- A disponibilidade do ZeroGPU depende da elegibilidade e das cotas da conta.