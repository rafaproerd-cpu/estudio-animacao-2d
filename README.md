# Estúdio de Animação 2D

Aplicativo mobile multiplataforma desenvolvido com Expo e React Native, pensado para uso pessoal em iPhone e Android.

## O que já funciona
- Criação local de projetos a partir de uma ideia, com gênero e duração.
- Planejamento de cenas, enquadramentos, movimentos de câmera, iluminação e prompts visuais.
- Edição da ficha do personagem, ações, diálogos e prompts de cada cena.
- Salvamento automático de projetos no aparelho.
- Cópia e compartilhamento do roteiro e dos prompts.
- Integração opcional com um servidor ComfyUI próprio para gerar imagens de cenas.
- Adaptador de imagem-para-vídeo que envia a imagem-chave, executa um workflow ComfyUI e recupera o clipe gerado.
- Configuração separada de workflow e IDs dos nós de vídeo, salva no aparelho e recarregada ao abrir o aplicativo.
- Cada cena pode solicitar um clipe de referência de quatro segundos a 16 FPS e reproduzi-lo dentro do app.
- Download dos clipes para o armazenamento do iPhone, permitindo reprodução offline.
- Exportação de clipes baixados pela folha de compartilhamento do iOS/Android, incluindo opção de salvar em Arquivos.
- Montagem dos clipes de um projeto em um único MP4 por um serviço FFmpeg próprio, com prévia e exportação no iPhone.
- Geração sequencial de imagens e clipes de todas as cenas em lote, com salvamento do progresso após cada cena.

## Estado real da geração
O planejador de cenas funciona localmente, mas não é um modelo generativo. A geração de imagens só funciona depois que o usuário conecta um servidor ComfyUI acessível pela rede, instala um modelo compatível e configura um workflow exportado em formato API que termine em `SaveImage`.

A geração de clipes de vídeo está implementada por workflow ComfyUI, mas ainda depende de configuração e validação com servidor/modelo reais. Os clipes retornados podem ser reproduzidos na própria tela do app e baixados para o armazenamento do aparelho. A montagem de várias cenas em um MP4 está integrada ao serviço opcional `render-server`, que precisa ser iniciado em um computador/servidor próprio com FFmpeg. O serviço agora aceita arquivos opcionais de narração e música e consegue mixá-los ao MP4 final (voz em volume normal e música em volume reduzido). O aplicativo já permite selecionar narração e música na biblioteca de arquivos do aparelho e copiar os áudios para armazenamento persistente do projeto antes de enviá-los à montagem. Transições ainda continuam pendentes. O aplicativo não simula que essas etapas foram concluídas.

## Custos e infraestrutura
A integração ComfyUI não cobra créditos por geração do aplicativo e não exige uma chave de API. Entretanto, o servidor e o hardware são do proprietário: GPU, energia, armazenamento, rede e manutenção podem ter custos. Modelos de vídeo de alta qualidade normalmente exigem uma máquina com GPU; não rodam diretamente no iPhone.

Não exponha uma instância ComfyUI ou o render-server sem proteção à internet pública. Prefira rede privada ou VPN e HTTPS. O app declara a permissão de rede local no iOS para acessar servidores na LAN; essa alteração exige gerar uma nova build nativa antes de testar. Conexões HTTP fora da rede local continuam sujeitas às regras ATS do iOS.

## Desenvolvimento
```bash
npm install
npx expo start
```

O projeto usa Expo SDK 54, React Native 0.81 e TypeScript. A checagem de tipos é executada pelo GitHub Actions com `npm run typecheck`.

## Builds
É possível configurar builds com Expo Application Services (EAS). A instalação direta em iPhone depende de assinatura/provisionamento Apple; a distribuição pela App Store exige conta Apple Developer. No Android, é possível gerar APK/AAB conforme o perfil de build.

## Próximas etapas
1. Validar os workflows reais de imagem e vídeo e o serviço FFmpeg em um iPhone conectado aos servidores próprios.
2. Integrar geração de voz, trilha sonora e sincronização labial.
3. Adicionar transições, títulos e controles de edição da linha do tempo.
4. Reforçar o acesso privado e a gestão segura das conexões.
