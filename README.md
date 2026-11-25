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
- Cada cena pode solicitar um clipe de referência de quatro segundos a 16 FPS e abrir o arquivo retornado pelo servidor.

## Estado real da geração
O planejador de cenas funciona localmente, mas não é um modelo generativo. A geração de imagens só funciona depois que o usuário conecta um servidor ComfyUI acessível pela rede, instala um modelo compatível e configura um workflow exportado em formato API que termine em `SaveImage`.

A geração de clipes de vídeo está implementada por workflow ComfyUI, mas ainda depende de configuração e validação com servidor/modelo reais. Os clipes retornados já podem ser reproduzidos na própria tela do app. Geração de voz, montagem de várias cenas e exportação final de um único MP4 ainda não estão implementadas. O aplicativo não simula que essas etapas foram concluídas.

## Custos e infraestrutura
A integração ComfyUI não cobra créditos por geração do aplicativo e não exige uma chave de API. Entretanto, o servidor e o hardware são do proprietário: GPU, energia, armazenamento, rede e manutenção podem ter custos. Modelos de vídeo de alta qualidade normalmente exigem uma máquina com GPU; não rodam diretamente no iPhone.

Não exponha uma instância ComfyUI sem proteção à internet pública. Prefira rede privada ou VPN e HTTPS. Em iOS, conexões HTTP sem TLS podem ser bloqueadas pelas políticas de segurança da plataforma.

## Desenvolvimento
```bash
npm install
npx expo start
```

O projeto usa Expo SDK 54, React Native 0.81 e TypeScript. A checagem de tipos é executada pelo GitHub Actions com `npm run typecheck`.

## Builds
É possível configurar builds com Expo Application Services (EAS). A instalação direta em iPhone depende de assinatura/provisionamento Apple; a distribuição pela App Store exige conta Apple Developer. No Android, é possível gerar APK/AAB conforme o perfil de build.

## Próximas etapas
1. Validar os workflows reais de imagem e vídeo em um iPhone conectado ao servidor ComfyUI.
2. Implementar gerenciamento e download local dos arquivos de vídeo.
3. Integrar geração de voz e sincronização com as cenas.
4. Montar todos os clipes e exportar um único MP4 final.
5. Reforçar o acesso privado e a gestão segura das conexões.
