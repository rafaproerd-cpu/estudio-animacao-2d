# Estúdio de Animação 2D

Aplicativo mobile multiplataforma, desenvolvido com Expo e React Native.

## Plataformas
- iPhone (iOS)
- Android

O mesmo código-fonte atende às duas plataformas. Este projeto é um aplicativo mobile; não estamos desenvolvendo um site como produto final.

## Estado atual
- Interface nativa para celular.
- Campo para descrever uma ideia.
- Seleção de gênero e duração.
- Estrutura inicial de personagem e cenas.
- Configuração Expo/EAS para builds iOS e Android.

## Rodar em desenvolvimento
`npm install`
`npx expo start`

## Gerar instaladores
É possível gerar builds na nuvem com Expo Application Services (EAS):
- iOS: `eas build --platform ios --profile preview`
- Android: `eas build --platform android --profile preview`

A instalação em iPhone requer provisionamento Apple. Distribuição pela App Store exige uma conta Apple Developer. O Android pode gerar um APK/AAB para instalação ou publicação, conforme o perfil de build.

## Próximas etapas
1. Testar e validar o app nos dois sistemas.
2. Salvar projetos no próprio aparelho.
3. Integrar geração de roteiro com IA.
4. Integrar imagens, vozes, animação e exportação MP4.
5. Implementar acesso privado.

## Limitações
A criação atual é uma estrutura inicial local, não uma geração completa por IA. Nenhum serviço pago ou chave de API foi conectado ainda.

Documentação: https://docs.expo.dev/build/introduction/
