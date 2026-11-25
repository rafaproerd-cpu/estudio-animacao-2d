# Arquitetura do motor de geração

## Objetivo do produto

Aplicativo privado de criação de animações 2D cinematográficas, com foco em qualidade visual, velocidade e ausência de cobrança por créditos por parte do próprio aplicativo.

## Princípio técnico

O aplicativo não deve fingir que um roteiro ou prompt é um vídeo gerado. Cada etapa deve ter um estado real e verificável: planejada, aguardando geração, gerando, concluída ou falhou.

## O que já existe

- Aplicativo Expo / React Native.
- Criação e armazenamento local de projetos.
- Planejamento local de histórias com quantidade variável de cenas, estimada pela duração escolhida (aproximadamente uma cena a cada oito segundos).
- Prompts de imagem e animação por cena.\n- Quantidade de cenas variável conforme a duração (30 segundos a 10 minutos na interface).\n- Contratos TypeScript para conectar provedores reais de imagem, vídeo e áudio, sem simular geração.
- Direção de enquadramento, câmera e iluminação.
- Regras de continuidade visual.
- Cópia do roteiro e dos prompts.

O planejador atual é baseado em modelos locais e regras determinísticas. Ele não é um modelo generativo e não produz imagens, áudio ou vídeo.

## Arquitetura alvo

1. **Planejador de história:** transforma a ideia em cenas, falas e instruções visuais.
2. **Gerador de referências:** cria a ficha visual do personagem e imagens de referência.
3. **Gerador de quadros:** produz imagens-chave para cada cena.
4. **Animador:** transforma quadros em clipes com movimento e câmera.
5. **Áudio:** gera ou importa narração, falas e efeitos sonoros.
6. **Montagem:** sincroniza clipes e áudio, adiciona transições e exporta MP4.
7. **Biblioteca local:** guarda projetos, referências e vídeos no aparelho.

## Política de custo

- Priorizar modelos de código aberto com licenças compatíveis com o uso pretendido.
- Preferir execução local ou infraestrutura que possa ser operada sem cobrança por geração.
- Nunca colocar chaves privadas de serviços no aplicativo.
- Não depender de créditos pagos como requisito para continuar criando.
- Informar claramente limites de hardware, filas, armazenamento e disponibilidade.
- Não prometer geração ilimitada gratuita em servidores de terceiros: processamento de vídeo tem custo real.

## Critérios para selecionar modelos

Cada candidato deve ser avaliado por:
- qualidade visual no estilo 2D cinematográfico;
- consistência de personagem entre cenas;
- duração e estabilidade do movimento;
- tempo de geração e requisitos de memória/VRAM;
- licença e permissões de uso;
- possibilidade de execução local;
- tamanho dos modelos e custo de armazenamento.

## Próximos marcos

1. Validar o planejador e os tipos do projeto.
2. Definir o contrato de integração dos provedores de imagem, vídeo e áudio.
3. Fazer um protótipo de geração de uma imagem de referência.
4. Fazer um protótipo de animação de um único clipe.
5. Implementar montagem e exportação MP4.
6. Otimizar velocidade, qualidade e continuidade.

## Estado atual

A aplicação ainda não tem geração real de imagem, vídeo ou áudio integrada. A próxima fase é escolher e testar um motor de geração que possa ser executado sem cobrar créditos por vídeo, considerando os recursos de hardware disponíveis.

## Pesquisa inicial de modelos (25/11/2026)

### Candidato prioritário para o primeiro teste: Wan2.2 TI2V-5B

- O modelo 5B aceita texto para vídeo e imagem para vídeo, com saída anunciada em 720p/24 fps.
- O repositório oficial informa execução em GPU de consumo com pelo menos 24 GB de VRAM para o fluxo 720p descrito.
- O projeto declara licença Apache 2.0 para os modelos.
- O repositório informa cerca de 9 minutos para gerar 5 segundos em 720p em uma GPU de consumo sem otimizações específicas.
- Referência oficial: https://github.com/Wan-Video/Wan2.2

**Decisão provisória:** testar Wan2.2 TI2V-5B primeiro, pois o mesmo modelo cobre texto-para-vídeo e imagem-para-vídeo e tem licença clara. Não está integrado ao aplicativo ainda.

### Alternativa para avaliar: HunyuanVideo-1.5

- O projeto oficial informa 8,3 bilhões de parâmetros e suporte a texto-para-vídeo e imagem-para-vídeo.
- O requisito mínimo anunciado é GPU NVIDIA com 14 GB de VRAM usando offloading, em Linux.
- Referência oficial: https://github.com/Tencent-Hunyuan/HunyuanVideo-1.5

### Limite importante

Esses modelos não rodam no iPhone como motor local de geração. O app móvel precisará conversar com um computador/servidor que execute o modelo, ou usar outro ambiente de execução. "Sem créditos por vídeo" não significa processamento sem custo: execução própria exige hardware, energia, armazenamento e tempo. A integração só será escolhida após validar o hardware realmente disponível.


## Primeiro adaptador real: ComfyUI para imagens

Foi criado `src/engine/providers/comfyuiImageProvider.ts`, um adaptador que conversa com uma instância ComfyUI autogerenciada:

1. recebe um workflow no formato API exportado pelo ComfyUI;
2. injeta o prompt positivo/negativo e, quando configurado, largura, altura e seed;
3. envia o workflow para `POST /prompt`;
4. consulta `GET /history/{prompt_id}` até a tarefa terminar;
5. retorna o endereço do arquivo produzido por `/view`.

A implementação segue as rotas HTTP documentadas pelo projeto ComfyUI: https://github.com/Comfy-Org/docs/blob/main/development/comfyui-server/comms_routes.mdx

### O que falta antes de gerar a primeira imagem dentro do app

- Criar uma instância ComfyUI acessível pela rede.
- Instalar um checkpoint/modelo de imagem compatível e montar um workflow de imagem com nó `SaveImage`.
- Configurar os IDs dos nós no adaptador.
- Adaptador já ligado à interface do aplicativo: há configuração local do servidor/workflow, teste de conexão e botão por cena para gerar e visualizar a imagem retornada.\n- Ainda falta validar a integração com uma instância ComfyUI real e um workflow/modelo concreto no iPhone.

O adaptador não inclui nem baixa modelos automaticamente e não representa geração disponível sem servidor. Ele não usa créditos de geração, mas exige máquina, GPU, energia e armazenamento próprios. Não exponha uma instância ComfyUI sem proteção diretamente à internet; prefira rede privada/VPN e HTTPS. Em iPhone, conexões HTTP sem TLS também podem ser bloqueadas pelas regras de segurança de transporte do iOS.


## Próxima integração: imagem-para-vídeo via ComfyUI

O próximo marco técnico é um provedor de vídeo que implemente `VideoGenerationProvider` e execute um workflow de animação real no ComfyUI. O fluxo esperado é:

1. receber a imagem-chave da cena e o prompt de movimento/câmera;
2. enviar a imagem ao servidor ComfyUI por um mecanismo de upload seguro, quando ela ainda não estiver disponível no armazenamento de entrada do servidor;
3. preencher os nós do workflow para imagem, prompt, duração/quadros, resolução, FPS e seed;
4. executar o workflow pela API HTTP e acompanhar o histórico até a conclusão;
5. identificar o artefato de vídeo retornado pelo nó de saída e recuperar o arquivo;
6. armazenar a referência do clipe no projeto e permitir sua pré-visualização no iPhone.

O workflow deve terminar em um nó de saída de vídeo, preferencialmente o nó nativo `SaveVideo`, configurado para MP4/H.264 quando compatível. A forma exata do artefato no histórico precisa ser validada com a versão e os nós instalados no servidor; o adaptador não deve presumir que todo workflow retorna o mesmo formato.

Referências oficiais:
- API e histórico do ComfyUI: https://github.com/Comfy-Org/ComfyUI/blob/master/openapi.yaml
- Implementação do nó nativo SaveVideo: https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_video.py
- Documentação do Save Video: https://github.com/Comfy-Org/embedded-docs/blob/main/comfyui_embedded_docs/docs/SaveVideo/en.md

**Importante:** o workflow pode usar modelos abertos como Wan2.2, mas o modelo precisa estar instalado no servidor e os requisitos de GPU devem ser atendidos. A interface do iPhone será o controle e a visualização; não executará sozinha a difusão de vídeo.


## Segundo adaptador real: ComfyUI para imagem-para-vídeo

Foi criado `src/engine/providers/comfyuiVideoProvider.ts`, que implementa `VideoGenerationProvider` para workflows ComfyUI configurados pelo proprietário.

O adaptador:
1. baixa a imagem-chave gerada para a cena;
2. envia a imagem para `POST /upload/image` como arquivo de entrada do ComfyUI;
3. injeta o nome retornado no nó `LoadImage`;
4. injeta prompt de movimento e, se configurados, largura, altura, quantidade de quadros, FPS e seed;
5. envia o workflow para `POST /prompt` e acompanha `GET /history/{prompt_id}`;
6. procura um artefato de vídeo MP4, WebM, MOV ou MKV na saída e monta a URL `/view`.

A interface agora permite colar um workflow de vídeo separado, configurar IDs de nós e solicitar um clipe de quatro segundos a 16 FPS por cena. O vídeo gerado fica registrado no projeto e pode ser aberto pelo endereço retornado pelo servidor. A reprodução embutida no app e o download/exportação local ainda não estão concluídos.

### Requisitos do workflow de vídeo

- Um nó `LoadImage` cujo campo de entrada padrão é `image`.
- Um pipeline real de imagem-para-vídeo, por exemplo Wan2.2 ou outro modelo instalado e suportado pelo servidor.
- Um nó `SaveVideo` configurado para MP4/H.264, se o workflow/modelo permitir.
- O ID do nó positivo de texto e os IDs opcionais para nós de resolução, quadros, FPS, seed e prompt negativo.
- Os campos de entrada padrão esperados pelo adaptador são `image`, `text`, `width`, `height`, `length`, `fps` e `seed`. Workflows com nomes diferentes exigem adaptação do código.

O endpoint oficial de upload de imagem é documentado nas rotas do ComfyUI: https://github.com/Comfy-Org/docs/blob/main/development/comfyui-server/comms_routes.mdx. O nó Save Video documentado pelo ComfyUI salva o vídeo no diretório de saída e permite escolher contêiner e codec: https://github.com/Comfy-Org/docs/blob/main/built-in-nodes/SaveVideo.mdx.

**Limites atuais:** a integração depende de um servidor ComfyUI real, workflow correto, modelos e GPU suficientes. Não foi executada geração real porque ainda não há servidor/modelo/workflow do usuário conectado. A validação automática do repositório verifica tipos TypeScript, não substitui o teste com hardware real.
