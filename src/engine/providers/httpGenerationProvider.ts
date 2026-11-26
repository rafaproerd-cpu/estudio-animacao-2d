import type {
  GenerationProgress,
  ImageGenerationProvider,
  ImageGenerationRequest,
  ProviderInfo,
  VideoGenerationProvider,
  VideoGenerationRequest,
} from "./types";

/**
 * Contrato HTTP neutro do Estúdio 2D.
 *
 * O app conversa com uma API única do produto; o backend escolhe o modelo
 * aberto instalado. Nenhum workflow ou ID de nó do ComfyUI chega ao celular.
 *
 * POST /v1/generations/images ou /v1/generations/videos
 *   -> { "job_id": "..." }
 * GET /v1/jobs/{job_id}
 *   -> { "status": "queued|running|completed|failed",
 *        "progress": 0..1, "message": "...",
 *        "output_url": "...", "error": "..." }
 */
type JobResponse = {
  job_id?: string;
  status?: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress?: number;
  message?: string;
  output_url?: string;
  error?: string;
};

export type HttpGenerationProviderOptions = {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  fetcher?: typeof fetch;
};

function normalizeUrl(value: string): string {
  const url = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("O serviço de geração ainda não está conectado. Endereço HTTP(S) inválido.");
  }
  return url;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Serviço de geração respondeu HTTP ${response.status}: ${body.slice(0, 500)}`);
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error("O serviço de geração retornou uma resposta inválida.");
  }
}

const wait = (milliseconds: number) =>
  new Promise<void>(resolve => setTimeout(resolve, milliseconds));

abstract class HttpGenerationProviderBase {
  protected readonly baseUrl: string;
  protected readonly token: string;
  protected readonly timeoutMs: number;
  protected readonly pollIntervalMs: number;
  protected readonly fetcher: typeof fetch;

  constructor(options: HttpGenerationProviderOptions) {
    this.baseUrl = normalizeUrl(options.baseUrl);
    this.token = options.token?.trim() ?? "";
    this.timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    this.fetcher = options.fetcher ?? fetch;
  }

  protected async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
    if (init.body) headers.set("Content-Type", "application/json");
    return parseResponse<T>(await this.fetcher(`${this.baseUrl}${path}`, { ...init, headers }));
  }

  protected async submitAndWait(path: string, payload: unknown): Promise<GenerationProgress> {
    try {
      const queued = await this.request<JobResponse>(path, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!queued.job_id) throw new Error("O serviço não retornou o identificador da tarefa.");

      const startedAt = Date.now();
      while (Date.now() - startedAt < this.timeoutMs) {
        const job = await this.request<JobResponse>(
          `/v1/jobs/${encodeURIComponent(queued.job_id)}`,
        );
        if (job.status === "completed") {
          if (!job.output_url) throw new Error("A tarefa terminou sem informar o arquivo gerado.");
          return {
            status: "completed",
            progress: 1,
            message: job.message ?? "Geração concluída.",
            outputUri: new URL(job.output_url, this.baseUrl).toString(),
          };
        }
        if (job.status === "failed" || job.status === "cancelled") {
          throw new Error(job.error || job.message || "A geração não foi concluída.");
        }
        await wait(this.pollIntervalMs);
      }
      return {
        status: "failed",
        progress: 0,
        error: "O tempo de espera terminou. A tarefa pode continuar no servidor.",
      };
    } catch (error) {
      return {
        status: "failed",
        progress: 0,
        error: error instanceof Error ? error.message : "Falha desconhecida no serviço de geração.",
      };
    }
  }
}

/** Adaptador para o endpoint de imagem integrado do Estúdio 2D. */
export class HttpImageGenerationProvider
  extends HttpGenerationProviderBase
  implements ImageGenerationProvider {
  readonly info: ProviderInfo = {
    id: "estudio2d-image-api",
    name: "Motor integrado de imagens",
    runtime: "self-hosted",
    requiresApiKey: false,
    requiresPaidCredits: false,
    supportsCancellation: false,
  };

  generate(request: ImageGenerationRequest): Promise<GenerationProgress> {
    return this.submitAndWait("/v1/generations/images", request);
  }
}

/** Adaptador para o endpoint de animação integrado do Estúdio 2D. */
export class HttpVideoGenerationProvider
  extends HttpGenerationProviderBase
  implements VideoGenerationProvider {
  readonly info: ProviderInfo = {
    id: "estudio2d-video-api",
    name: "Motor integrado de animação",
    runtime: "self-hosted",
    requiresApiKey: false,
    requiresPaidCredits: false,
    supportsCancellation: false,
  };

  generate(request: VideoGenerationRequest): Promise<GenerationProgress> {
    return this.submitAndWait("/v1/generations/videos", request);
  }
}
