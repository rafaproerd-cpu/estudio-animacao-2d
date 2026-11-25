# Servidor de montagem do Estúdio 2D

Este serviço opcional transforma os clipes gerados no app em um único MP4. Ele deve rodar na mesma máquina/rede do servidor ComfyUI, ou em outra máquina com acesso ao iPhone e espaço suficiente.

## Requisitos

- Python 3.10 ou superior
- FFmpeg instalado e disponível no PATH
- Rede privada/VPN; não exponha este serviço diretamente à internet pública

## Instalação

```bash
cd render-server
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate
pip install -r requirements.txt
```

Crie um token longo e aleatório e configure a variável de ambiente `ESTUDIO_RENDER_TOKEN`.

Windows PowerShell:
```powershell
$env:ESTUDIO_RENDER_TOKEN="coloque-seu-token-longo-aqui"
uvicorn main:app --host 0.0.0.0 --port 8765
```

macOS/Linux:
```bash
export ESTUDIO_RENDER_TOKEN="coloque-seu-token-longo-aqui"
uvicorn main:app --host 0.0.0.0 --port 8765
```

O app deve usar `http://IP-DA-MAQUINA:8765` em rede local, ou um endereço HTTPS protegido por VPN/reverse proxy. O endpoint `/health` permite verificar se o FFmpeg foi encontrado. O endpoint `POST /render` exige `Authorization: Bearer TOKEN` e recebe vários arquivos no campo multipart `clips`, na ordem desejada. O serviço normaliza resolução para 1024×576, 30 FPS e H.264, concatena os segmentos e retorna uma URL para baixar o MP4.

## Limites atuais

- A montagem atual é sequencial, sem transições, trilha ou narração.
- O áudio é removido dos clipes; a faixa de voz/música será adicionada em uma etapa posterior.
- Cada clipe tem limite padrão de 500 MB e cada montagem aceita até 80 clipes.
- Os MP4 finais ficam em `outputs/`; proteja o disco e faça limpeza periódica dos arquivos.
- O token protege os endpoints, mas não substitui HTTPS/VPN. Não use uma porta pública sem uma camada de segurança.
