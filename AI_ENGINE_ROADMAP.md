# Plano do motor integrado do Estúdio 2D

## Objetivo do produto
A pessoa deve criar um projeto, descrever a história e produzir cenas, imagens, animações, vozes e MP4 sem precisar instalar plugins, colar workflows ou configurar endpoints manualmente.

## Situação real atual
- O app organiza projetos e cria um storyboard local baseado em regras e modelos de texto quando não há provedor conectado. Também possui integração opcional com um provedor compatível com Chat Completions para gerar roteiros originais; ela exige credenciais configuradas no servidor e ainda não está ativada no ambiente publicado.
- O app já possui adaptadores HTTP conectados aos endpoints de jobs do backend para solicitar e consultar imagens e clipes. O fluxo de cliente está implementado, mas a geração remota real depende de um backend hospedado com motores configurados; o site publicado sozinho não gera mídia.
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
- [x] Implementar endpoint autenticado de roteiro original por provedor Chat Completions, validação do JSON e mapeamento de cenas para o app.
- [x] Conectar o fluxo de criação do app ao provedor de roteiro quando disponível, com fallback local explícito.
- [x] Exibir status do motor de roteiro e áudio ao testar a conexão do servidor.
- [ ] Configurar credenciais de um provedor de texto no servidor hospedado e executar teste real de roteiro ponta a ponta.
- [x] Empacotar o servidor de montagem em Docker.
- [x] Confirmar uma execução bem-sucedida da etapa Docker no CI (imagem do servidor construída no GitHub Actions).
- [x] Corrigir o Dockerfile para incluir `story_engine.py`, necessário à importação da API, e validar a importação de `main` durante a construção da imagem.
- [ ] Remover dependências legadas de ComfyUI da configuração e da interface, mantendo somente os adaptadores HTTP internos de geração.
- [x] Definir o contrato HTTP do lado cliente para envio e consulta de jobs de imagem/vídeo.
- [x] Criar respostas autenticadas e explícitas de indisponibilidade para os endpoints de imagem/vídeo (HTTP 503, sem simular jobs).
- [x] Implementar uma primeira fila de jobs de imagem SDXL no servidor, com status queued/running/completed/failed, erros explícitos e links privados de download com expiração (fila em memória; sem persistência ainda).
- [x] Registrar jobs e tokens temporários de download em SQLite e limitar concorrência de jobs de imagem. A execução continua em memória; tarefas interrompidas por reinício são marcadas como falhas. Cancelamento e progresso granular ainda faltam.
- [ ] Selecionar modelos abertos compatíveis com GPU/VRAM e licenças adequadas; testar qualidade, tempo e requisitos reais antes de fixar a escolha.
- [x] Criar o primeiro adaptador backend de imagem SDXL via Diffusers, carregado sob demanda e ativado somente quando modelo, dependências e dispositivo estão disponíveis.
- [x] Implementar image-to-image no motor SDXL local e no Space Hugging Face ZeroGPU, com envio opcional de imagem-base pelo backend. A referência ajuda na continuidade visual, mas não garante identidade perfeita; se o Space rejeitar a referência por incompatibilidade, o app pode repetir a geração sem ela.
- [x] Criar adaptador experimental de vídeo Wan2.2 TI2V 5B usando o CLI oficial, upload Base64 de imagem, fila e link de saída protegido.
- [ ] Instalar runtime oficial Wan2.2, pesos TI2V 5B e testar uma geração I2V real em GPU com pelo menos 24 GB de VRAM total (guardião do backend: cerca de 23 GB livres).
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

**Estado atualizado:** `POST /v1/generations/images` aceita prompts e cria jobs SDXL apenas quando `IMAGE_MODEL_ID`, Diffusers, PyTorch e o dispositivo configurado estão prontos. Os jobs podem ser consultados em `GET /v1/jobs/{job_id}`; o resultado é servido por link privado temporário. O estado dos jobs e as permissões temporárias de download são persistidos em SQLite; a execução permanece em memória e tarefas em andamento são marcadas como interrompidas após reinício. A UI consulta os jobs pelos adaptadores HTTP. Tanto o SDXL local quanto o Space ZeroGPU possuem entrada image-to-image opcional; o Space recebe a imagem de referência como arquivo temporário via Gradio Client e a remove após a chamada. `POST /v1/generations/videos` aceita prompt e imagem Base64 e cria jobs Wan2.2 TI2V somente quando o CLI oficial, checkpoint, PyTorch/CUDA e memória livre suficiente estão configurados. Nenhum modelo foi instalado no ambiente publicado e nenhuma inferência real foi executada ainda.


## Avaliação inicial de modelos abertos (não instalados)

Esta é uma shortlist para protótipo, não uma promessa de geração já disponível:

| Etapa | Candidato | Motivo para avaliar | Limite conhecido |
|---|---|---|---|
| Imagem | SDXL 1.0 Base | Modelo de texto-para-imagem conhecido, pode rodar sozinho sem o refiner e tem licença OpenRAIL++-M | Precisa de GPU compatível para uso prático; a licença tem condições e restrições de uso. A consistência de personagens precisa ser testada com referências/LoRAs. |
| Vídeo com imagem de referência | Wan2.2 TI2V 5B | Um único modelo oficial suporta texto-para-vídeo e imagem-para-vídeo; licença Apache 2.0; saída 720p a 24 FPS | A documentação oficial indica GPU com pelo menos 24 GB de VRAM (ex.: RTX 4090) e menos de 9 minutos para 5 segundos em 720p sob a configuração descrita. Não é gratuito hospedar a GPU e o resultado anime/2D precisa ser avaliado. |

### Plano de avaliação antes de instalar
1. Confirmar licença e requisitos da versão exata dos pesos e de todos os componentes auxiliares. Para vídeo image-to-video, priorizar o Wan2.2 TI2V 5B em vez do Wan2.1 T2V 1.3B, pois este último é o checkpoint T2V e não é o melhor encaixe para animar a imagem-base de cada cena.
2. Fazer teste de imagem com a mesma ficha de personagem em 10 cenas diferentes; medir consistência de rosto, roupa e paleta.
3. Fazer teste de vídeo image-to-video/text-to-video com movimento de câmera e movimento corporal; medir artefatos, duração, resolução e tempo por clipe.
4. Só então criar o adaptador backend. O modelo de vídeo escolhido pode mudar se o teste não atingir qualidade 2D/anime desejada.
5. Manter os pesos fora do repositório Git; baixar em volume persistente durante o provisionamento do servidor.

Referências oficiais consultadas:
- SDXL 1.0 Base (model card e licença): https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0
- Wan2.1 T2V 1.3B (model card, licença e requisitos; candidato anterior, apenas T2V): https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B
- Wan2.2 TI2V 5B (model card oficial, tarefas T2V/I2V, licença e requisitos): https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B
- Wan2.2 official inference script and CLI options: https://github.com/Wan-Video/Wan2.2/blob/main/generate.py
- Wan2.1 (tarefas e resoluções suportadas): https://github.com/Wan-Video/Wan2.1

**Decisão atual (revisada em 25/11/2026):** SDXL 1.0 Base segue como candidato para imagens; Wan2.2 TI2V 5B passa a ser o principal candidato para animação image-to-video. São candidatos para teste apenas: nenhum peso foi baixado, nenhum motor foi instalado e nenhuma geração foi ativada no servidor.


## Provedor alternativo de vídeo: Agnes Video 2.5 Flash (avaliado em 27/11/2026)

A documentação oficial confirma uma API assíncrona de vídeo:
- Criar tarefa: `POST https://apihub.agnes-ai.com/v1/videos`.
- Consultar tarefa: `GET https://apihub.agnes-ai.com/agnesapi?video_id=<VIDEO_ID>&model_name=agnes-video-2.5-flash`.
- Modelo Flash: `agnes-video-2.5-flash`; somente 720P; duração de 4 a 12 segundos; até 5 imagens de referência e 3 áudios; não aceita vídeo de referência.
- Para imagem de referência, a API exige URLs publicamente acessíveis em `images[]` (modo reference) ou `first_frame`/`last_frame` (modo keyframe). O backend atual recebe imagem Base64 privada do app; será necessário criar um link temporário, aleatório, somente leitura e com expiração para disponibilizar a imagem ao provedor sem expor arquivos do usuário.
- A resposta é assíncrona; salvar `video_id`, consultar até `completed`/`failed` e baixar o MP4 de `url`.
- A documentação lista US$ 0,025/segundo como preço normal e US$ 0/segundo como preço promocional para Angel User Trial. A promoção é temporária e pode mudar. Não presumir que toda conta está elegível nem ativar chamadas automaticamente.

**Travas obrigatórias antes de produção:**
1. O provedor deve permanecer desativado por padrão e sem chamadas de rede até haver chave configurada no servidor e ativação explícita.
2. Antes de ativar, confirmar no painel da conta se o preço aplicável é realmente US$ 0; caso contrário, exigir autorização expressa do usuário para qualquer cobrança. Nunca trocar silenciosamente para o modelo pago `agnes-video-2.5`.
3. Nunca enviar chave ao app, ao GitHub, aos logs ou ao chat.
4. Implementar URL temporária para a imagem de referência, com token aleatório, expiração curta e validação de PNG/JPEG; não publicar os arquivos por nome previsível.
5. Testar criação, polling, download, falhas, timeout, expiração do link e limite de duração antes de anunciar o motor como pronto.

**Estado:** documentação oficial consultada; integração ainda não implementada nem ativada. O Wan 2.2/Hugging Face continua como motor atual, sujeito à cota ZeroGPU. A API Agnes é uma alternativa comercial/promocional, não uma solução comprovadamente gratuita e ilimitada.

Referência oficial: https://wiki.agnes-ai.com/en/docs/agnes-video-25-flash

---

## Diagnóstico de hardware no backend

- [x] O endpoint autenticado `GET /v1/capabilities` detecta GPUs NVIDIA via `nvidia-smi` e informa nome, memória total, memória livre e versão do driver reportadas.
- [x] A detecção é opcional: se `nvidia-smi` não existir ou falhar, a API continua funcionando e retorna `gpu_detection: not_detected`.
- [ ] Essas métricas são apenas um retrato do driver no momento da consulta; não comprovam compatibilidade CUDA nem capacidade de executar SDXL/Wan. Validar o ambiente real antes de instalar pesos.
- [x] Adicionar runtime opcional SDXL via Diffusers, sem incluir PyTorch/CUDA pesado na imagem Docker padrão.
- [ ] Instalar o runtime opcional em GPU compatível, carregar o checkpoint e medir VRAM/tempo/qualidade com uma inferência real.
- [x] Criar adaptador experimental Wan2.2 TI2V 5B via CLI oficial, com verificação de script, checkpoint e VRAM e fila autenticada.
- [ ] Quando um servidor GPU for escolhido, validar runtime CUDA, compatibilidade das bibliotecas e memória disponível durante inferências reais.


## Validação CI mais recente

Em 26/11/2026, no commit `9243f7fe8312cdf07ee17e7a27a88a916e5e7153`, os workflows **Mobile app validation**, **Render server checks** e **Deploy browser preview** concluíram com sucesso. Isso valida compilação, testes automatizados, construção do container e publicação da interface. Não valida uma geração real de imagem/vídeo no Hugging Face ou em GPU Wan2.2; esses testes ainda dependem de publicar e configurar os serviços externos.
