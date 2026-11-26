# Plano do motor integrado do Estúdio 2D

## Objetivo do produto
A pessoa deve criar um projeto, descrever a história e produzir cenas, imagens, animações, vozes e MP4 sem precisar instalar plugins, colar workflows ou configurar endpoints manualmente.

## Situação real atual
- O app organiza projetos e cria um storyboard local baseado em regras e modelos de texto. Isso ainda não é um modelo de IA generativa.
- Existe um adaptador HTTP genérico no app para um futuro motor integrado. A geração real ainda não está conectada.
- O servidor FastAPI/FFmpeg monta clipes e tem endpoints opcionais de voz Piper, mas precisa ser hospedado e receber os modelos/binários necessários.
- A interface web está publicada; isso não hospeda o motor de inferência.
- Não existe neste momento um serviço de geração de imagem/vídeo pronto, ilimitado e gratuito conectado ao app.

## Arquitetura-alvo
1. **Direção criativa local:** transformar a ideia em roteiro, ficha de personagens, storyboard e prompts com regras de continuidade. Manter isso utilizável sem rede.
2. **Motor de imagem substituível:** interface interna única para um modelo aberto de geração de imagem. A seleção do modelo e a infraestrutura devem ficar no backend, nunca como workflow manual para o usuário.
3. **Motor de animação substituível:** receber imagem de referência, prompt e duração; devolver clipe com estado de progresso e erros claros.
4. **Voz local:** Piper opcional no servidor, com modelos licenciados e seleção de voz por cena.
5. **Montagem:** FFmpeg concatena clipes, voz e música e produz MP4.
6. **Experiência mobile-first:** uma tela de criação e uma fila de produção; nenhum campo de servidor/workflow na experiência normal.

## Restrições honestas
- `requiresPaidCredits: false` nos adaptadores significa apenas que não há cobrança por créditos de API de terceiros; não significa hospedagem/inferência gratuita. Modelos abertos podem ser usados sem pagar licença, mas inferência de vídeo exige GPU, memória, armazenamento e energia.
- GitHub Pages só publica a interface estática; não executa modelos.
- Um container Docker empacota o backend, mas não fornece GPU nem hospedagem.
- Hospedagem gratuita tem limites, pode dormir ou não oferecer GPU. Não prometer geração ilimitada gratuita.
- Se não houver máquina compatível disponível, o app pode continuar oferecendo roteiro/storyboard local e montagem de arquivos enviados, mas geração automática de mídia ficará indisponível.

## Próximas etapas técnicas
- [x] Empacotar o servidor de montagem em Docker.
- [ ] Confirmar uma execução bem-sucedida da etapa Docker no CI após sua inclusão no workflow.
- [ ] Separar a API interna do provedor ComfyUI, para que a UI não dependa de detalhes de workflow.
- [x] Definir o contrato HTTP do lado cliente para envio e consulta de jobs de imagem/vídeo.
- [x] Criar respostas autenticadas e explícitas de indisponibilidade para os endpoints de imagem/vídeo (HTTP 503, sem simular jobs).
- [ ] Implementar o contrato de jobs no servidor, com fila real, progresso, cancelamento e mensagens de erro.
- [ ] Selecionar modelos abertos compatíveis com GPU/VRAM e licenças adequadas; testar qualidade, tempo e requisitos reais antes de fixar a escolha.
- [ ] Criar adaptadores backend para os modelos escolhidos e remover configuração manual da experiência principal.
- [ ] Hospedar backend em hardware compatível e conectar o app com autenticação.
- [ ] Testar ponta a ponta em iPhone: ideia → cenas → imagens → animação → voz → MP4.

## Critério de pronto
Só considerar a geração integrada pronta quando um usuário conseguir, no iPhone, criar um projeto e obter um MP4 real sem preencher endereço de servidor, JSON de workflow ou IDs de nós.

## Contrato HTTP interno (primeira implementação no app)
O app agora possui adaptadores genéricos em `src/engine/providers/httpGenerationProvider.ts`:
- `POST /v1/generations/images`
- `POST /v1/generations/videos`
- `GET /v1/jobs/{job_id}`

A API responde com `job_id`; a consulta de status devolve `queued`, `running`, `completed`, `failed` ou `cancelled`. Ao concluir, informa `output_url`. O app resolve URLs relativas contra o endereço-base e aceita token Bearer opcional.

**Importante:** os endpoints `POST /v1/generations/images` e `POST /v1/generations/videos` já existem no backend, mas retornam HTTP 503 de forma intencional até que modelos reais sejam instalados. Ainda não há fila de jobs nem geração de imagem/vídeo ativa. Os adaptadores do app não ativam geração por si só. Próxima etapa: definir e testar o contrato de capacidades e jobs antes de instalar um modelo real.


## Avaliação inicial de modelos abertos (não instalados)

Esta é uma shortlist para protótipo, não uma promessa de geração já disponível:

| Etapa | Candidato | Motivo para avaliar | Limite conhecido |
|---|---|---|---|
| Imagem | SDXL 1.0 Base | Modelo de texto-para-imagem conhecido, pode rodar sozinho sem o refiner e tem licença OpenRAIL++-M | Precisa de GPU compatível para uso prático; a licença tem condições e restrições de uso. A consistência de personagens precisa ser testada com referências/LoRAs. |
| Vídeo | Wan2.1 T2V 1.3B | Pesos Apache-2.0; versão compacta com geração 480p | A documentação do modelo informa 8,19 GB de VRAM e cerca de 4 minutos para 5 segundos em RTX 4090; isso ainda é hardware caro e não roda no iPhone. |

### Plano de avaliação antes de instalar
1. Confirmar licença e requisitos da versão exata dos pesos e de todos os componentes auxiliares.
2. Fazer teste de imagem com a mesma ficha de personagem em 10 cenas diferentes; medir consistência de rosto, roupa e paleta.
3. Fazer teste de vídeo image-to-video/text-to-video com movimento de câmera e movimento corporal; medir artefatos, duração, resolução e tempo por clipe.
4. Só então criar o adaptador backend. O modelo de vídeo escolhido pode mudar se o teste não atingir qualidade 2D/anime desejada.
5. Manter os pesos fora do repositório Git; baixar em volume persistente durante o provisionamento do servidor.

Referências oficiais consultadas:
- SDXL 1.0 Base (model card e licença): https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0
- Wan2.1 T2V 1.3B (model card, licença e requisitos): https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B
- Wan2.1 (tarefas e resoluções suportadas): https://github.com/Wan-Video/Wan2.1

**Decisão atual:** candidatos para teste apenas. Nenhum peso foi baixado, nenhum motor foi instalado e nenhuma geração foi ativada no servidor.


## Diagnóstico de hardware no backend

- [x] O endpoint autenticado `GET /v1/capabilities` detecta GPUs NVIDIA via `nvidia-smi` e informa nome, memória total, memória livre e versão do driver reportadas.
- [x] A detecção é opcional: se `nvidia-smi` não existir ou falhar, a API continua funcionando e retorna `gpu_detection: not_detected`.
- [ ] Essas métricas são apenas um retrato do driver no momento da consulta; não comprovam compatibilidade CUDA nem capacidade de executar SDXL/Wan. Validar o ambiente real antes de instalar pesos.
- [ ] Quando um servidor GPU for escolhido, validar runtime CUDA, compatibilidade das bibliotecas e memória disponível durante uma inferência real.
