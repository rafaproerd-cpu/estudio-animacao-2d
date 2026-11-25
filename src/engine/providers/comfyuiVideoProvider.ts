import type {
  GenerationProgress,
  ProviderInfo,
  VideoGenerationProvider,
  VideoGenerationRequest,
} from "./types";

type WorkflowNode = {
  class_type: string;
  inputs: Record<string, unknown>;
};
export type ComfyUiVideoWorkflow = Record<string, WorkflowNode>;

export type ComfyUiVideoProviderOptions = {
  baseUrl: string;
  workflow: ComfyUiVideoWorkflow;
  imageNodeId: string;
  imageInputName?: string;
  positivePromptNodeId: string;
  negativePromptNodeId?: string;
  widthNodeId?: string;
  heightNodeId?: string;
  framesNodeId?: string;
  fpsNodeId?: string;
  seedNodeId?: string;
  promptInputName?: string;
  negativePromptInputName?: string;
  widthInputName?: string;
  heightInputName?: string;
  framesInputName?: string;
  fpsInputName?: string;
  seedInputName?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
};

type UploadedImage = { name: string; subfolder?: string; type?: string };
type ComfyOutput = {
  images?: Array<{ filename?: string; subfolder?: string; type?: string }>;
  gifs?: Array<{ filename?: string; subfolder?: string; type?: string }>;
  videos?: Array<{ filename?: string; subfolder?: string; type?: string }>;
};
type ComfyHistoryEntry = {
  outputs?: Record<string, ComfyOutput>;
  status?: { status_str?: string; completed?: boolean; messages?: unknown[] };
};

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\\/+$/, "");
  if (!/^https?:\\/\\//i.test(trimmed)) {
    throw new Error("Informe o endereço completo do servidor ComfyUI (http:// ou https://).");
  }
  return trimmed;
}

function setInput(workflow: ComfyUiVideoWorkflow, nodeId: string | undefined, input: string, value: unknown) {
  if (!nodeId) return;
  const node = workflow[nodeId];
  if (!node) throw new Error(`O nó ${nodeId} não existe no workflow de vídeo.`);
  node.inputs[input] = value;
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.text();
  if (!response.ok) throw new Error(`ComfyUI respondeu HTTP ${response.status}: ${body.slice(0, 500)}`);
  try { return JSON.parse(body) as T; }
  catch { throw new Error("O servidor ComfyUI retornou uma resposta inválida."); }
}

function delay(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function uploadReferenceImage(baseUrl: string, imageUri: string): Promise<UploadedImage> {
  const imageResponse = await fetch(imageUri);
  if (!imageResponse.ok) throw new Error(`Não foi possível baixar a imagem de referência (HTTP ${imageResponse.status}).`);
  const blob = await imageResponse.blob();
  if (!blob.size) throw new Error("A imagem de referência está vazia.");
  const form = new FormData();
  form.append("image", blob, `estudio2d-reference-${Date.now()}.png`);
  form.append("type", "input");
  form.append("overwrite", "true");
  const uploaded = await json<UploadedImage>(await fetch(`${baseUrl}/upload/image`, {
    method: "POST",
    body: form,
  }));
  if (!uploaded.name) throw new Error("O ComfyUI não informou o nome da imagem enviada.");
  return uploaded;
}

/**
 * Geração de clipes por workflow ComfyUI autogerenciado.
 * A imagem-chave é enviada para /upload/image e o workflow deve conter
 * um nó LoadImage ligado ao pipeline de vídeo e um nó SaveVideo.
 */
export class ComfyUiVideoProvider implements VideoGenerationProvider {
  readonly info: ProviderInfo = {
    id: "comfyui-self-hosted-video",
    name: "ComfyUI vídeo (servidor próprio)",
    runtime: "self-hosted",
    requiresApiKey: false,
    requiresPaidCredits: false,
    supportsCancellation: false,
  };

  private readonly baseUrl: string;
  private readonly options: ComfyUiVideoProviderOptions;

  constructor(options: ComfyUiVideoProviderOptions) {
    this.options = options;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    if (!options.workflow || !options.imageNodeId || !options.positivePromptNodeId) {
      throw new Error("Configure o workflow, o nó LoadImage e o nó do prompt positivo.");
    }
  }

  async generate(request: VideoGenerationRequest): Promise<GenerationProgress> {
    try {
      if (!request.imageUri) throw new Error("Esta cena ainda não tem uma imagem de referência. Gere a imagem antes de animá-la.");
      const uploaded = await uploadReferenceImage(this.baseUrl, request.imageUri);
      const workflow = JSON.parse(JSON.stringify(this.options.workflow)) as ComfyUiVideoWorkflow;
      const names = {
        image: this.options.imageInputName ?? "image",
        prompt: this.options.promptInputName ?? "text",
        negative: this.options.negativePromptInputName ?? "text",
        width: this.options.widthInputName ?? "width",
        height: this.options.heightInputName ?? "height",
        frames: this.options.framesInputName ?? "length",
        fps: this.options.fpsInputName ?? "fps",
        seed: this.options.seedInputName ?? "seed",
      };

      setInput(workflow, this.options.imageNodeId, names.image, uploaded.name);
      setInput(workflow, this.options.positivePromptNodeId, names.prompt, request.prompt);
      setInput(workflow, this.options.negativePromptNodeId, names.negative, request.negativePrompt ?? "");
      setInput(workflow, this.options.widthNodeId, names.width, request.width);
      setInput(workflow, this.options.heightNodeId, names.height, request.height);
      setInput(workflow, this.options.framesNodeId, names.frames, Math.max(1, Math.round(request.durationSeconds * request.fps)));
      setInput(workflow, this.options.fpsNodeId, names.fps, request.fps);
      if (request.seed !== undefined) setInput(workflow, this.options.seedNodeId, names.seed, request.seed);

      const queued = await json<{ prompt_id?: string; node_errors?: Record<string, unknown> }>(
        await fetch(`${this.baseUrl}/prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: workflow, client_id: `estudio2d-video-${Date.now()}` }),
        }),
      );
      if (!queued.prompt_id) {
        throw new Error(queued.node_errors
          ? `Workflow de vídeo rejeitado: ${JSON.stringify(queued.node_errors).slice(0, 700)}`
          : "O ComfyUI não retornou o identificador da geração de vídeo.");
      }

      const timeoutMs = this.options.timeoutMs ?? 30 * 60 * 1000;
      const pollMs = this.options.pollIntervalMs ?? 2000;
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        await delay(pollMs);
        const history = await json<Record<string, ComfyHistoryEntry>>(
          await fetch(`${this.baseUrl}/history/${encodeURIComponent(queued.prompt_id)}`),
        );
        const entry = history[queued.prompt_id];
        if (!entry) continue;
        if (entry.status?.status_str === "error") {
          throw new Error(`A geração de vídeo falhou. ${JSON.stringify(entry.status.messages ?? []).slice(0, 700)}`);
        }
        const artifacts = Object.values(entry.outputs ?? {}).flatMap(output => [
          ...(output.videos ?? []),
          ...(output.gifs ?? []),
          ...(output.images ?? []),
        ]);
        const video = artifacts.find(item => item.filename && /\\.(mp4|webm|mov|mkv)$/i.test(item.filename));
        if (entry.status?.completed || entry.status?.status_str === "success") {
          if (!video?.filename) {
            throw new Error("O workflow terminou, mas não retornou um arquivo de vídeo. Verifique o nó SaveVideo.");
          }
          const query = [
            `filename=${encodeURIComponent(video.filename)}`,
            `type=${encodeURIComponent(video.type ?? "output")}`,
            `subfolder=${encodeURIComponent(video.subfolder ?? "")}`,
          ].join("&");
          return {
            status: "completed",
            progress: 1,
            message: "Clipe de vídeo gerado pelo servidor ComfyUI.",
            outputUri: `${this.baseUrl}/view?${query}`,
          };
        }
      }
      return {
        status: "failed",
        progress: 0,
        error: "Tempo limite aguardando o vídeo. A tarefa pode continuar na fila do ComfyUI.",
      };
    } catch (error) {
      return {
        status: "failed",
        progress: 0,
        error: error instanceof Error ? error.message : "Erro desconhecido ao gerar vídeo no ComfyUI.",
      };
    }
  }
}
