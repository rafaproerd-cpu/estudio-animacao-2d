/**
 * Contratos dos motores de geração.
 *
 * As implementações concretas serão conectadas depois que o ambiente de
 * execução (aparelho próprio ou computador com GPU) estiver definido.
 * Nenhum provedor é ativado por este arquivo.
 */

export type GenerationStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type GenerationProgress = {
  status: GenerationStatus;
  progress: number;
  message?: string;
  outputUri?: string;
  error?: string;
};

export type ProviderRuntime = "local-device" | "self-hosted" | "remote";

export type ProviderInfo = {
  id: string;
  name: string;
  runtime: ProviderRuntime;
  requiresApiKey: boolean;
  requiresPaidCredits: boolean;
  supportsCancellation: boolean;
};

export type ImageGenerationRequest = {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  seed?: number;
  referenceImageUris?: string[];
};

export type VideoGenerationRequest = {
  prompt: string;
  imageUri?: string;
  /** Base64 de uma imagem PNG/JPEG local, para upload ao motor TI2V. */
  imageBase64?: string;
  negativePrompt?: string;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  seed?: number;
};

export type AudioGenerationRequest = {
  text: string;
  language: string;
  voiceId?: string;
  referenceAudioUri?: string;
};

export interface ImageGenerationProvider {
  readonly info: ProviderInfo;
  generate(request: ImageGenerationRequest): Promise<GenerationProgress>;
}

export interface VideoGenerationProvider {
  readonly info: ProviderInfo;
  generate(request: VideoGenerationRequest): Promise<GenerationProgress>;
}

export interface AudioGenerationProvider {
  readonly info: ProviderInfo;
  generate(request: AudioGenerationRequest): Promise<GenerationProgress>;
}

/** Nenhum provedor falso/padrão: a ausência de integração deve ser explícita. */
export type GenerationProviders = {
  image?: ImageGenerationProvider;
  video?: VideoGenerationProvider;
  audio?: AudioGenerationProvider;
};
