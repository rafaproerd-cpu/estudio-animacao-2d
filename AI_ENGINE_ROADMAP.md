# Plano do motor integrado do Estúdio 2D

## Objetivo do produto
A pessoa deve criar um projeto, descrever a história e produzir cenas, imagens, animações, vozes e MP4 sem precisar instalar plugins, colar workflows ou configurar endpoints manualmente.

## Situação real atual
- O app organiza projetos e cria um storyboard local baseado em regras e modelos de texto. Isso ainda não é um modelo de IA generativa.
- A geração de imagens e de clipes está ligada a um adaptador ComfyUI que exige servidor, workflow e IDs de nós preenchidos manualmente.
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
- Modelos abertos podem ser usados sem pagar licença, mas inferência de vídeo exige GPU, memória, armazenamento e energia.
- GitHub Pages só publica a interface estática; não executa modelos.
- Um container Docker empacota o backend, mas não fornece GPU nem hospedagem.
- Hospedagem gratuita tem limites, pode dormir ou não oferecer GPU. Não prometer geração ilimitada gratuita.
- Se não houver máquina compatível disponível, o app pode continuar oferecendo roteiro/storyboard local e montagem de arquivos enviados, mas geração automática de mídia ficará indisponível.

## Próximas etapas técnicas
- [x] Empacotar o servidor de montagem em Docker e validar a construção no CI.
- [ ] Separar a API interna do provedor ComfyUI, para que a UI não dependa de detalhes de workflow.
- [ ] Definir contratos de job assíncrono para imagem e vídeo, com progresso, cancelamento e mensagens de erro.
- [ ] Selecionar modelos abertos compatíveis com GPU/VRAM e licenças adequadas; testar qualidade, tempo e requisitos reais antes de fixar a escolha.
- [ ] Criar adaptadores backend para os modelos escolhidos e remover configuração manual da experiência principal.
- [ ] Hospedar backend em hardware compatível e conectar o app com autenticação.
- [ ] Testar ponta a ponta em iPhone: ideia → cenas → imagens → animação → voz → MP4.

## Critério de pronto
Só considerar a geração integrada pronta quando um usuário conseguir, no iPhone, criar um projeto e obter um MP4 real sem preencher endereço de servidor, JSON de workflow ou IDs de nós.
