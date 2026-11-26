# Avaliação técnica: Hugging Face ZeroGPU

Data da avaliação: 26/11/2026

## Decisão

O ZeroGPU é uma opção real para um protótipo gratuito de geração de imagens, mas **não é uma hospedagem gratuita ilimitada** e não resolve sozinho a geração de vídeo do Estúdio 2D. Não deve ser anunciado como motor pronto.

## O que a documentação oficial confirma

- Contas pessoais gratuitas em situação regular podem hospedar até dois Spaces ZeroGPU, desde que tenham e-mail verificado e mais de 30 dias.
- ZeroGPU funciona exclusivamente com SDK Gradio.
- A cota incluída para uma conta gratuita é de 5 minutos de GPU por dia; para uso sem autenticação, a documentação indica 2 minutos. A cota é compartilhada e a prioridade depende do saldo.
- Os Spaces Gradio podem ser chamados por API HTTP em duas etapas: enviar a chamada e acompanhar o evento até o resultado.
- A cota é limitada por conta e não equivale a cinco minutos de vídeo pronto. Tempo de fila, carregamento e inferência tornam a capacidade prática variável.

Fontes oficiais:
- https://huggingface.co/docs/hub/main/spaces-zerogpu
- https://huggingface.co/docs/hub/spaces-api-endpoints
- https://huggingface.co/docs/hub/spaces-overview

## Compatibilidade com o Estúdio 2D

O Estúdio 2D já tem um contrato HTTP próprio para jobs de imagem e vídeo (POST /v1/generations/... e GET /v1/jobs/{job_id}). O ZeroGPU não implementa esse contrato: ele expõe a API de um Space Gradio, com formato e fluxo diferentes.

Uma ponte no backend poderia traduzir o contrato interno do Estúdio 2D para a API Gradio. O token Hugging Face deve ficar somente no servidor, nunca no aplicativo ou no código público. A ponte também precisaria tratar fila, eventos SSE, timeout, falhas e limites de cota.

## Plano seguro de protótipo

1. Criar um Space Gradio ZeroGPU privado ou público com um modelo leve de imagem adequado ao estilo 2D/anime.
2. Guardar o token Hugging Face como segredo no ambiente do servidor, se a chamada autenticada for necessária.
3. Implementar a ponte no backend e manter o contrato atual do app.
4. Fazer uma inferência real e medir tempo, qualidade, cota consumida e consistência do personagem antes de ligar o botão de produção.
5. Não prometer geração ilimitada gratuita. O limite diário pode ser insuficiente para projetos com muitas cenas.

## Bloqueios e decisão atual

- Ainda não existe um Space criado para este projeto.
- Não há token Hugging Face fornecido ou configurado.
- Nenhuma inferência foi executada.
- O ZeroGPU não é uma solução comprovada para o modelo de vídeo Wan2.2 nem substitui o servidor de vídeo.

**Decisão:** manter ZeroGPU como candidato de protótipo para imagem, sem substituir o backend atual nem afirmar que a geração está disponível. Não pedir ao usuário para configurar contas ou tokens até existir uma prova técnica ponta a ponta e um caminho de integração simples.