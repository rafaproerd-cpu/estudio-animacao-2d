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
