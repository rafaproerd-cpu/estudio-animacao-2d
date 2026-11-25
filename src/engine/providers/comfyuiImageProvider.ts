import type {
  GenerationProgress,
  ImageGenerationProvider,
  ImageGenerationRequest,
  ProviderInfo,
} from "./types";

type WorkflowNode = {
  class_type: string;
  inputs: Record<string, unknown>;
};

export type ComfyUiImageWorkflow = Record<string, WorkflowNode>;

export type ComfyUiImageProviderOptions = {
  /** Endereço do ComfyUI, por exemplo http://192.168.0.10:8188. */
  baseUrl: string;
  /** Workflow API exportado pelo ComfyUI (não o JSON visual do editor). */
  workflow: ComfyUiImageWorkflow;
  /** ID do nó CLIPTextEncode positivo. */
  positivePromptNodeId: string;
  /** ID do nó CLIPTextEncode negativo, se o workflow tiver um. */
  negativePromptNodeId?: string;
  /** IDs opcionais dos nós que recebem largura, altura e seed. */
  widthNodeId?: string;
  heightNodeId?: string;
  seedNodeId?: string;
  /** Nome dos campos de entrada; os padrões atendem aos nós comuns. */
  promptInputName?: string;
  negativePromptInputName?: string;
  widthInputName?: string;
  heightInputName?: string;
  seedInputName?: string;
  /** Tempo máximo de espera pelo resultado. Padrão: 10 minutos. */
  timeoutMs?: number;
  /** Intervalo de consulta da fila. Padrão: 1,5 segundo. */
  pollIntervalMs?: number;
};

type ComfyHistoryEntry = {
  outputs?: Record<string, {
    images?: Array<{ filename?: string; subfolder?: string; type?: string }>;
  }>;
  status?: {
    status_str?: string;
    completed?: boolean;
    messages?: unknown[];
  };
};

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("Informe o endereço completo do servidor ComfyUI (http:// ou https://).");
  }
  return trimmed;
}

function setNodeInput(
  workflow: ComfyUiImageWorkflow,
  nodeId: string | undefined,
  inputName: string,
  value: unknown,
): void {
  if (!nodeId) return;
  const node = workflow[nodeId];
  if (!node) throw new Error(`O nó ${nodeId} não existe no workflow configurado.`);
  node.inputs[inputName] = value;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`ComfyUI respondeu HTTP ${response.status}: ${body.slice(0, 500)}`);
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error("O servidor ComfyUI retornou uma resposta inválida.");
  }
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Provedor de imagem para uma instância ComfyUI controlada pelo proprietário.
 * Não inclui hospedagem, modelos, créditos ou autenticação: o servidor precisa
 * estar acessível pela rede e protegido pelo próprio ambiente.
 */
export class ComfyUiImageProvider implements ImageGenerationProvider {
  readonly info: ProviderInfo = {
    id: "comfyui-self-hosted",
    name: "ComfyUI (servidor próprio)",
    runtime: "self-hosted",
    requiresApiKey: false,
    requiresPaidCredits: false,
    supportsCancellation: false,
  };

  private readonly baseUrl: string;
  private readonly options: ComfyUiImageProviderOptions;

  constructor(options: ComfyUiImageProviderOptions) {
    this.options = options;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    if (!options.workflow || !options.positivePromptNodeId) {
      throw new Error("Configure o workflow e o nó de prompt positivo do ComfyUI.");
    }
  }

  async generate(request: ImageGenerationRequest): Promise<GenerationProgress> {
    try {
      const workflow = JSON.parse(JSON.stringify(this.options.workflow)) as ComfyUiImageWorkflow;
      const names = {
        prompt: this.options.promptInputName ?? "text",
        negative: this.options.negativePromptInputName ?? "text",
        width: this.options.widthInputName ?? "width",
        height: this.options.heightInputName ?? "height",
        seed: this.options.seedInputName ?? "seed",
      };

      setNodeInput(workflow, this.options.positivePromptNodeId, names.prompt, request.prompt);
      setNodeInput(workflow, this.options.negativePromptNodeId, names.negative, request.negativePrompt ?? "");
      setNodeInput(workflow, this.options.widthNodeId, names.width, request.width);
      setNodeInput(workflow, this.options.heightNodeId, names.height, request.height);
      if (request.seed !== undefined) {
        setNodeInput(workflow, this.options.seedNodeId, names.seed, request.seed);
      }

      const queued = await readJson<{ prompt_id?: string; node_errors?: Record<string, unknown> }>(
        await fetch(`${this.baseUrl}/prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: workflow,
            client_id: `estudio2d-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          }),
        }),
      );

      if (!queued.prompt_id) {
        throw new Error(
          queued.node_errors
            ? `Workflow rejeitado pelo ComfyUI: ${JSON.stringify(queued.node_errors).slice(0, 700)}`
            : "O ComfyUI não retornou o identificador da geração.",
        );
      }

      const timeoutMs = this.options.timeoutMs ?? 10 * 60 * 1000;
      const pollIntervalMs = this.options.pollIntervalMs ?? 1500;
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        await wait(pollIntervalMs);
        const history = await readJson<Record<string, ComfyHistoryEntry>>(
          await fetch(`${this.baseUrl}/history/${encodeURIComponent(queued.prompt_id)}`),
        );
        const entry = history[queued.prompt_id];
        if (!entry) continue;

        const images = Object.values(entry.outputs ?? {}).flatMap(output => output.images ?? []);
        const image = images.find(item => item.filename);
        const failed = entry.status?.status_str === "error";

        if (failed) {
          const details = JSON.stringify(entry.status?.messages ?? []).slice(0, 700);
          throw new Error(`A geração falhou no ComfyUI. ${details}`);
        }

        if (entry.status?.completed || entry.status?.status_str === "success") {
          if (!image?.filename) {
            throw new Error("O workflow terminou, mas não retornou uma imagem. Verifique se há um nó SaveImage.");
          }
          const query = [
            `filename=${encodeURIComponent(image.filename)}`,
            `type=${encodeURIComponent(image.type ?? "output")}`,
            `subfolder=${encodeURIComponent(image.subfolder ?? "")}`,
          ].join("&");
          return {
            status: "completed",
            progress: 1,
            message: "Imagem gerada pelo servidor ComfyUI.",
            outputUri: `${this.baseUrl}/view?${query}`,
          };
        }
      }

      return {
        status: "failed",
        progress: 0,
        error: "Tempo limite excedido aguardando o ComfyUI. A tarefa pode continuar na fila do servidor.",
      };
    } catch (error) {
      return {
        status: "failed",
        progress: 0,
        error: error instanceof Error ? error.message : "Erro desconhecido ao conectar ao ComfyUI.",
      };
    }
  }
}
