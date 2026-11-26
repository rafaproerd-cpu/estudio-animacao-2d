import gradio as gr
import spaces
import torch
from diffusers import AutoPipelineForText2Image

MODEL_ID = "stabilityai/sdxl-turbo"
_pipe = None

def get_pipeline():
    global _pipe
    if _pipe is None:
        _pipe = AutoPipelineForText2Image.from_pretrained(
            MODEL_ID,
            torch_dtype=torch.float16,
            variant="fp16",
            use_safetensors=True,
        ).to("cuda")
    return _pipe

@spaces.GPU(duration=60)
def generate_image(prompt: str, seed: int = 12345):
    prompt = (prompt or "").strip()
    if len(prompt) < 8:
        raise gr.Error("Descreva a cena com pelo menos 8 caracteres.")
    if len(prompt) > 1200:
        raise gr.Error("A descrição deve ter no máximo 1.200 caracteres.")

    safe_seed = int(seed) % (2**32)
    generator = torch.Generator(device="cuda").manual_seed(safe_seed)
    pipeline = get_pipeline()
    result = pipeline(
        prompt=prompt,
        num_inference_steps=4,
        guidance_scale=0.0,
        height=512,
        width=512,
        generator=generator,
    )
    return result.images[0]

with gr.Blocks(title="Estúdio 2D - teste de imagem") as demo:
    gr.Markdown(
        "# Estúdio 2D — teste de geração de imagem\n"
        "Protótipo experimental com SDXL Turbo em ZeroGPU. "
        "A disponibilidade depende da cota diária e da fila do Hugging Face."
    )
    prompt = gr.Textbox(
        label="Descrição da cena",
        placeholder="Ex.: personagem de anime em uma cidade futurista à noite...",
        lines=4,
        max_lines=6,
    )
    seed = gr.Number(label="Semente do projeto", value=12345, precision=0)
    generate = gr.Button("Gerar imagem", variant="primary")
    output = gr.Image(label="Imagem gerada", type="pil")
    generate.click(generate_image, inputs=[prompt, seed], outputs=output, api_name="generate")

demo.queue()
demo.launch()
