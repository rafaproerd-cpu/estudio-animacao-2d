import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, Linking, SafeAreaView, ScrollView, Share, StatusBar, StyleSheet,
  Text, TextInput, TouchableOpacity, View, Image, Platform
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import * as SecureStore from "expo-secure-store";
import { useVideoPlayer, VideoView } from "expo-video";
import { createStoryPlan, type Genre, type StoryPlan } from "./src/engine/storyEngine";
import { HttpImageGenerationProvider, HttpVideoGenerationProvider } from "./src/engine/providers/httpGenerationProvider";

const ttsVoiceLabel = (voice: string) => {
  if (voice === "pt_BR-cadu-medium") return "Cadu · masculino";
  if (voice === "pt_BR-faber-medium") return "Faber · masculino";
  if (voice === "pt_BR-razo-medium") return "Razo · masculino";
  if (voice === "ptbr-tiny-f") return "Tiny Voca · feminino (PT-BR)";
  return voice;
};

type Scene = { title: string; description: string; dialogue: string; imagePrompt: string; videoPrompt: string; shot: string; camera: string; lighting: string; voiceId?: string; imageUri?: string; videoUri?: string; videoRemoteUri?: string; audioUri?: string };
type Project = {
  id: string;
  title: string;
  idea: string;
  genre: string;
  duration: string;
  character: string;
  scenes: Scene[];
  finalVideoUri?: string;
  finalVideoRemoteUri?: string;
  narrationUri?: string;
  musicUri?: string;
  createdAt: string;
  storyEngine?: "local-template" | "ai-provider";
};

const STORAGE_KEY = "@estudio2d/projects-v1";
const ENGINE_STORAGE_KEY = "@estudio2d/engine-v2";
const LEGACY_ENGINE_STORAGE_KEY = "@estudio2d/comfyui-v1";
type EngineConfig = {
  renderBaseUrl?: string;
  renderToken?: string;
};
const genres = ["Aventura", "Comédia", "Fantasia", "Ação", "Drama", "Mistério"];
const durations = ["30 segundos", "1 minuto", "2 minutos", "3 minutos", "5 minutos", "10 minutos"];
const RENDER_TOKEN_KEY = "@estudio2d/render-token";

function showUserAlert(title: string, message: string): void {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.alert(title + "\n\n" + message);
    return;
  }
  Alert.alert(title, message);
}

function isAllowedEngineUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol === "https:") return true;
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === "http:" && (host === "localhost" || host === "127.0.0.1" || host === "[::1]");
  } catch {
    return false;
  }
}

async function readRenderToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    if (typeof window === "undefined") return null;
    // Keep the server token across reloads and browser restarts on the same device.
    // Migrate a token saved by older builds in sessionStorage.
    const persistentToken = window.localStorage.getItem(RENDER_TOKEN_KEY);
    if (persistentToken) return persistentToken;
    const legacyToken = window.sessionStorage.getItem(RENDER_TOKEN_KEY);
    if (legacyToken) {
      window.localStorage.setItem(RENDER_TOKEN_KEY, legacyToken);
      window.sessionStorage.removeItem(RENDER_TOKEN_KEY);
      return legacyToken;
    }
    return null;
  }
  return SecureStore.getItemAsync(RENDER_TOKEN_KEY);
}

async function writeRenderToken(token: string): Promise<void> {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") {
      if (token) window.localStorage.setItem(RENDER_TOKEN_KEY, token);
      else {
        window.localStorage.removeItem(RENDER_TOKEN_KEY);
        window.sessionStorage.removeItem(RENDER_TOKEN_KEY);
      }
    }
    return;
  }
  if (token) await SecureStore.setItemAsync(RENDER_TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(RENDER_TOKEN_KEY);
}


function findCharacterReference(scenes: Scene[], targetTitle?: string): Scene | undefined {
  // A primeira cena funciona como referência-mestra para o elenco.
  // Ao gerar a própria cena-mestra novamente, usa a primeira alternativa disponível.
  const master = scenes[0];
  if (master?.imageUri && master.title !== targetTitle) return master;
  return scenes.find(item => item.title !== targetTitle && !!item.imageUri);
}

function stableProjectSeed(seedKey: string): number {
  // Uma semente fixa por projeto e cena torna cada cena reproduzível sem repetir a mesma composição em todas.
  let hash = 2166136261;
  for (let index = 0; index < seedKey.length; index += 1) {
    hash ^= seedKey.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildProject(idea: string, genre: string, duration: string, generatedPlan?: StoryPlan): Project {
  const character = "Personagem principal\nNome: a definir\nAparência: a definir\nRoupa: a definir\nPersonalidade: a definir\nVoz: a definir\nRegra de continuidade: manter o mesmo rosto, cabelo, roupa, cores e proporções em todas as cenas.";
  const plan = generatedPlan || createStoryPlan(idea, genre as Genre, duration, character);
  return {
    id: Date.now().toString(),
    title: plan.title,
    idea: plan.premise,
    genre,
    duration,
    character,
    scenes: plan.scenes.map(scene => ({
      title: scene.title,
      description: scene.action,
      dialogue: scene.dialogue,
      imagePrompt: scene.imagePrompt,
      videoPrompt: scene.videoPrompt,
      shot: scene.shot,
      camera: scene.camera,
      lighting: scene.lighting
    })),
    createdAt: new Date().toISOString(),
    storyEngine: plan.generatedBy
  };
}

function requestedDurationSeconds(duration: string): number {
  const value = duration.trim().toLowerCase();
  const minutes = value.match(/(\d+(?:[.,]\d+)?)\s*min/);
  const seconds = value.match(/(\d+(?:[.,]\d+)?)\s*seg/);
  const total = (minutes ? Number(minutes[1].replace(",", ".")) * 60 : 0)
    + (seconds ? Number(seconds[1].replace(",", ".")) : 0);
  return total > 0 ? Math.max(10, Math.round(total)) : 60;
}

function sceneClipDurationSeconds(project: Project): number {
  const targetSeconds = requestedDurationSeconds(project.duration);
  const sceneCount = Math.max(1, project.scenes.length);
  // Mantém a duração fracionária para que a soma dos clipes acompanhe
  // a duração escolhida, sem perder segundos ao arredondar cada cena.
  return Math.min(5, Math.max(1, targetSeconds / sceneCount));
}

function estimatedGeneratedDurationSeconds(project: Project): number {
  return sceneClipDurationSeconds(project) * project.scenes.length;
}

async function downloadGeneratedAudio(audioUrl: string, token: string, destination: string): Promise<string> {
  if (Platform.OS === "web") {
    // No navegador, Expo FileSystem.downloadAsync não é confiável. Baixa com fetch
    // autenticado e grava como data URL para continuar disponível no projeto salvo.
    const response = await fetch(audioUrl, { headers: { Authorization: "Bearer " + token } });
    if (!response.ok) throw new Error("O servidor não entregou o áudio (HTTP " + response.status + ").");
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("O navegador não conseguiu salvar o áudio recebido."));
      reader.onload = () => typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Formato de áudio recebido inválido."));
      reader.readAsDataURL(blob);
    });
  }
  const directory = (FileSystem.documentDirectory || "") + "project-audio/";
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const download = await FileSystem.downloadAsync(audioUrl, destination, { headers: { Authorization: "Bearer " + token } });
  if (download.status < 200 || download.status >= 300) throw new Error("O download do áudio falhou (HTTP " + download.status + ").");
  return download.uri;
}

function updateCharacterInPrompt(prompt: string, previous: string, next: string): string {
  const marker = "\nFICHA FIXA DO PERSONAGEM: ";
  const markerAt = prompt.indexOf(marker);
  const base = markerAt >= 0 ? prompt.slice(0, markerAt) : prompt;
  const oldText = `Personagem: ${previous}.`;
  const replaced = base.includes(oldText)
    ? base.replace(oldText, `Personagem: ${next}.`)
    : base;
  return replaced + marker + next;
}

function projectText(project: Project) {
  return [
    project.title,
    "Gênero: " + project.genre,
    "Duração: " + project.duration,
    "",
    "IDEIA ORIGINAL",
    project.idea,
    "",
    "FICHA DO PERSONAGEM",
    project.character,
    "",
    ...project.scenes.flatMap(scene => [scene.title, scene.description, scene.dialogue, "VOZ: " + (scene.voiceId || "voz padrão do projeto"), "ENQUADRAMENTO: " + (scene.shot || "plano médio"), "CÂMERA: " + (scene.camera || "movimento suave"), "ILUMINAÇÃO: " + (scene.lighting || "luz cinematográfica"), "PROMPT DE IMAGEM: " + (scene.imagePrompt || ""), "PROMPT DE ANIMAÇÃO: " + (scene.videoPrompt || ""), ""])
  ].join("\n");
}

function SceneVideoPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, instance => {
    instance.loop = true;
  });
  return <VideoView player={player} style={styles.videoPlayer} nativeControls contentFit="contain" />;
}

function NarrationAudioPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, instance => {
    // A narração toca uma vez e para; os controles nativos permitem reproduzir novamente.
    instance.loop = false;
  });
  return <VideoView player={player} style={{ width: "100%", height: 64, backgroundColor: "#171722", borderRadius: 10 }} nativeControls contentFit="contain" />;
}

export default function App() {
  const [idea, setIdea] = useState("");
  const [genre, setGenre] = useState("Aventura");
  const [duration, setDuration] = useState("1 minuto");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [ready, setReady] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [engineConfig, setEngineConfig] = useState<EngineConfig>({ renderBaseUrl: "", renderToken: "" });
  const [connectionStatus, setConnectionStatus] = useState("Não testada");
  const [busyScene, setBusyScene] = useState<string | null>(null);
  const [creatingStory, setCreatingStory] = useState(false);
  const [storyFeedback, setStoryFeedback] = useState("");
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [imageFeedback, setImageFeedback] = useState("");
  const [videoFeedback, setVideoFeedback] = useState("");
  const [ttsVoices, setTtsVoices] = useState<string[]>([]);
  const [selectedTtsVoice, setSelectedTtsVoice] = useState("");
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsFeedback, setTtsFeedback] = useState("");
  const [voicePreviewUri, setVoicePreviewUri] = useState("");
  const [voicePreviewId, setVoicePreviewId] = useState("");
  const [previewLoadingId, setPreviewLoadingId] = useState("");
  const scrollViewRef = useRef<any>(null);
  const scrollOffsetRef = useRef(0);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(ENGINE_STORAGE_KEY).then(async current => current ?? await AsyncStorage.getItem(LEGACY_ENGINE_STORAGE_KEY)),
      readRenderToken(),
    ])
      .then(async ([value, token]) => {
        const saved = value ? JSON.parse(value) as Partial<EngineConfig> : {};
        const legacyToken = saved.renderToken;
        delete saved.renderToken;
        if (!token && legacyToken) await writeRenderToken(legacyToken);
        if (value) {
          await AsyncStorage.setItem(ENGINE_STORAGE_KEY, JSON.stringify(saved));
          await AsyncStorage.removeItem(LEGACY_ENGINE_STORAGE_KEY);
        }
        setEngineConfig(prev => ({ ...prev, ...saved, renderToken: token || legacyToken || "" }));
      })
      .catch(() => Alert.alert("Aviso", "Não foi possível carregar as configurações seguras do servidor."));
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(value => {
        if (value) setProjects(JSON.parse(value) as Project[]);
      })
      .catch(() => Alert.alert("Aviso", "Não foi possível carregar os projetos salvos."))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (ready) {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
        .catch(() => Alert.alert("Erro ao salvar", "Confira o espaço disponível no aparelho."));
    }
  }, [projects, ready]);

  const saveEngineConfig = async () => {
    try {
      const { renderToken, ...publicConfig } = engineConfig;
      await AsyncStorage.setItem(ENGINE_STORAGE_KEY, JSON.stringify(publicConfig));
      await writeRenderToken(renderToken?.trim() || "");
      Alert.alert("Conexão salva", "O endereço do motor foi guardado no aparelho; o token fica no armazenamento seguro do iPhone.");
    } catch {
      Alert.alert("Erro", "Não foi possível salvar as configurações. Verifique o armazenamento do aparelho.");
    }
  };


  const testRenderConnection = async () => {
    const url = (engineConfig.renderBaseUrl || "").trim().replace(/\/+$/, "");
    if (!isAllowedEngineUrl(url)) {
      Alert.alert("Endereço inválido", "Use um endereço HTTPS seguro. HTTP só é permitido para testes locais em localhost.");
      return;
    }
    try {
      const headers = { Authorization: `Bearer ${(engineConfig.renderToken || "").trim()}` };
      const response = await fetch(`${url}/health`, { headers });
      const health = await response.json();
      if (!response.ok || !health.ok || !health.token_configured) {
        throw new Error("O servidor respondeu, mas o token não foi aceito ou a API não está pronta.");
      }
      const capabilitiesResponse = await fetch(`${url}/v1/capabilities`, { headers });
      const capabilities = await capabilitiesResponse.json();
      if (!capabilitiesResponse.ok) throw new Error(capabilities.detail || "Não foi possível consultar os motores.");
      const story = capabilities.engines?.story;
      const image = capabilities.engines?.image;
      const imageRemote = capabilities.engines?.image_remote;
      const video = capabilities.engines?.video;
      const audio = capabilities.engines?.audio;
      const imageAuthentication = imageRemote?.authentication === "token_configured" ? "HF autenticado" : "HF sem token";
      let imageDiagnostic = "diagnóstico remoto ainda não consultado";
      try {
        const diagnosticResponse = await fetch(`${url}/v1/diagnostics/image-provider`, { headers });
        if (diagnosticResponse.ok) {
          const diagnostic = await diagnosticResponse.json();
          imageDiagnostic = diagnostic.connectivity === "reachable"
            ? "Space HF acessível · endpoint confirmado"
            : diagnostic.connectivity === "reachable_api_mismatch"
              ? "Space HF acessível, mas endpoint incompatível"
              : diagnostic.connectivity === "connection_failed"
                ? `falha ao acessar Space HF: ${diagnostic.diagnostic_error || "erro não detalhado"}`
                : diagnostic.message || diagnostic.connectivity || imageDiagnostic;
        } else {
          imageDiagnostic = `diagnóstico indisponível (HTTP ${diagnosticResponse.status})`;
        }
      } catch (diagnosticError) {
        imageDiagnostic = "não foi possível consultar o diagnóstico do Space HF";
      }
      let agnesDiagnostic = "não consultada";
      try {
        const agnesResponse = await fetch(`${url}/v1/diagnostics/agnes`, { headers });
        if (agnesResponse.ok) {
          const agnes = await agnesResponse.json();
          agnesDiagnostic = agnes.authenticated
            ? `chave autenticada · modelo Flash ${agnes.video_model_listed ? "listado" : "não listado"}`
            : agnes.status === "authentication_failed"
              ? "chave recusada pelo provedor"
              : agnes.status === "key_missing"
                ? "chave AGNES_API_KEY ausente no servidor"
                : "provedor indisponível para consulta";
        } else {
          agnesDiagnostic = `diagnóstico indisponível (HTTP ${agnesResponse.status})`;
        }
      } catch {
        agnesDiagnostic = "não foi possível consultar a Agnes";
      }
      const status = `Conectado · roteiro: ${story?.status || "desconhecido"} · imagem: ${image?.status || "desconhecido"} (${imageAuthentication}) · ${imageDiagnostic} · Agnes: ${agnesDiagnostic} · vídeo: ${video?.status || "desconhecido"} · áudio: ${audio?.status || "desconhecido"}`;
      setConnectionStatus(status);
      Alert.alert(
        "Motor conectado",
        `API conectada. Roteiro: ${story?.message || story?.status || "não informado"} Imagem: ${image?.message || image?.status || "não informado"}. Diagnóstico HF: ${imageDiagnostic}. Agnes: ${agnesDiagnostic}. Vídeo: ${video?.message || video?.status || "não informado"} Áudio: ${audio?.message || audio?.status || "não informado"}`
      );
    } catch (error) {
      setConnectionStatus("Falha na conexão");
      Alert.alert("Não conectou", error instanceof Error ? error.message : "Verifique endereço, rede e servidor.");
    }
  };

  const getEngineConnection = () => {
    const baseUrl = (engineConfig.renderBaseUrl || "").trim().replace(new RegExp("/+$"), "");
    const token = (engineConfig.renderToken || "").trim();
    if (!isAllowedEngineUrl(baseUrl) || !token) {
      showUserAlert("Conecte o motor do Estúdio 2D", "Informe um endereço HTTPS seguro e o token na opção Conectar motor.");
      setShowSettings(true);
      return null;
    }
    return { baseUrl, token };
  };

  const persistGeneratedImage = async (remoteUri: string, projectId: string, sceneTitle: string) => {
    if (Platform.OS === "web") {
      const response = await fetch(remoteUri);
      if (!response.ok) throw new Error(`Não foi possível baixar a imagem gerada (HTTP ${response.status}).`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      try {
        const image = document.createElement("img");
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("Não foi possível preparar a imagem para salvar no navegador."));
          image.src = objectUrl;
        });
        const canvas = document.createElement("canvas");
        canvas.width = 1024;
        canvas.height = 576;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("O navegador não conseguiu preparar a imagem.");
        // Preencher o quadro 16:9 sem deformar o personagem ou o cenário.
        const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
        const sourceWidth = canvas.width / scale;
        const sourceHeight = canvas.height / scale;
        const sourceX = (image.naturalWidth - sourceWidth) / 2;
        const sourceY = (image.naturalHeight - sourceHeight) / 2;
        context.drawImage(
          image,
          sourceX, sourceY, sourceWidth, sourceHeight,
          0, 0, canvas.width, canvas.height
        );
        return canvas.toDataURL("image/jpeg", 0.82);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }
    try {
      if (!FileSystem.documentDirectory) throw new Error("Armazenamento local indisponível.");
      const directory = FileSystem.documentDirectory + "generated-images/";
      const info = await FileSystem.getInfoAsync(directory);
      if (!info.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      const safeName = sceneTitle.replace(/[^a-z0-9-_]/gi, "-").slice(0, 48) || "scene";
      const destination = directory + projectId + "-" + safeName + "-" + Date.now() + ".png";
      const download = await FileSystem.downloadAsync(remoteUri, destination);
      if (download.status < 200 || download.status >= 300) throw new Error(`HTTP ${download.status}`);
      return download.uri;
    } catch (error) {
      // Preserve a imagem gerada mesmo quando o aparelho não consegue copiá-la localmente.
      console.warn("Imagem gerada, mas a cópia local falhou:", error);
      return remoteUri;
    }
  };

  const persistGeneratedVideo = async (remoteUri: string, projectId: string, sceneTitle: string) => {
    // No navegador, mantenha o link protegido; no iPhone, salve uma cópia local
    // para que o projeto continue funcionando depois que o link temporário expirar.
    if (Platform.OS === "web") return remoteUri;
    try {
      const directory = (FileSystem.documentDirectory || "") + "scene-videos/";
      if (!FileSystem.documentDirectory) throw new Error("Armazenamento local indisponível.");
      const info = await FileSystem.getInfoAsync(directory);
      if (!info.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      const filenameParam = remoteUri.match(/[?&]filename=([^&]+)/)?.[1];
      const sourceFilename = filenameParam ? decodeURIComponent(filenameParam) : "";
      const extension = sourceFilename.match(/\.(mp4|webm|mov|mkv)$/i)?.[1] || "mp4";
      const safeName = sceneTitle.replace(/[^a-z0-9-_]/gi, "-").slice(0, 48) || "scene";
      const destination = `${directory}${projectId}-${safeName}-${Date.now()}.${extension}`;
      const download = await FileSystem.downloadAsync(remoteUri, destination);
      if (download.status < 200 || download.status >= 300) {
        throw new Error(`HTTP ${download.status}`);
      }
      return download.uri;
    } catch (error) {
      // Não descarte um clipe que já foi gerado: preserve o link remoto para
      // permitir nova tentativa de download durante a montagem do MP4.
      console.warn("Clipe gerado, mas a cópia local falhou:", error);
      return remoteUri;
    }
  };

  const generateSceneImage = async (scene: Scene) => {
    if (!selected) return;
    const connection = getEngineConnection();
    if (!connection) return;
    setBusyScene(scene.title);
    try {
      const provider = new HttpImageGenerationProvider({ baseUrl: connection.baseUrl, token: connection.token });
      const referenceScene = findCharacterReference(selected.scenes, scene.title);
      const referenceImageBase64 = referenceScene?.imageUri ? await imageUriToBase64(referenceScene.imageUri) : undefined;
      let result = await provider.generate({ prompt: scene.imagePrompt, width: 1024, height: 576, seed: stableProjectSeed(`${selected.id}:${scene.title}`), referenceImageBase64 });
      // Se o motor remoto rejeitar a referência visual, repetir sem ela para
      // que a geração individual ainda possa funcionar.
      if (
        result.status !== "completed" &&
        referenceImageBase64 &&
        /somente texto|referência.*não.*suportada|não.*suporta.*referência/i.test(result.error || "")
      ) {
        result = await provider.generate({
          prompt: scene.imagePrompt,
          width: 1024,
          height: 576,
          seed: stableProjectSeed(`${selected.id}:${scene.title}`),
        });
      }
      if (result.status !== "completed" || !result.outputUri) throw new Error(result.error || "O motor não retornou uma imagem.");
      const localUri = await persistGeneratedImage(result.outputUri, selected.id, scene.title);
      const updated = { ...selected, finalVideoUri: undefined, finalVideoRemoteUri: undefined, scenes: selected.scenes.map(item => item.title === scene.title ? { ...item, imageUri: localUri, videoUri: undefined, videoRemoteUri: undefined } : item) };
      saveUpdatedProject(updated);
      Alert.alert("Imagem gerada", "A imagem foi criada pelo motor do Estúdio 2D. Se a cópia local falhar, o app mantém o link do arquivo.");
    } catch (error) { Alert.alert("Erro na geração", error instanceof Error ? error.message : "Não foi possível gerar a imagem."); }
    finally { setBusyScene(null); }
  };

  const imageUriToBase64 = async (imageUri: string) => {
    if (imageUri.startsWith("data:")) return imageUri.split(",", 2)[1] || "";
    if (Platform.OS === "web") {
      const response = await fetch(imageUri);
      if (!response.ok) throw new Error(`Não foi possível carregar a imagem de referência (HTTP ${response.status}).`);
      const blob = await response.blob();
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result || "");
          const encoded = dataUrl.split(",", 2)[1];
          if (encoded) resolve(encoded);
          else reject(new Error("Não foi possível converter a imagem de referência."));
        };
        reader.onerror = () => reject(new Error("Falha ao ler a imagem de referência."));
        reader.readAsDataURL(blob);
      });
    }
    let localUri = imageUri;
    if (!localUri.startsWith("file://")) {
      const cachePath = (FileSystem.cacheDirectory || FileSystem.documentDirectory || "") + "estudio2d-reference-" + Date.now() + ".png";
      const downloaded = await FileSystem.downloadAsync(localUri, cachePath);
      if (downloaded.status < 200 || downloaded.status >= 300) throw new Error("Não foi possível baixar a imagem de referência.");
      localUri = downloaded.uri;
    }
    return FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
  };

  const generateSceneVideo = async (scene: Scene) => {
    if (!selected) return;
    if (!scene.imageUri) {
      showUserAlert("Imagem necessária", "Gere primeiro a imagem desta cena para usá-la como referência do vídeo.");
      return;
    }
    const connection = getEngineConnection();
    if (!connection) return;
    setVideoFeedback("Preparando a animação da cena. Aguarde...");
    setBusyScene("video:" + scene.title);
    try {
      const imageBase64 = await imageUriToBase64(scene.imageUri);
      const provider = new HttpVideoGenerationProvider({ baseUrl: connection.baseUrl, token: connection.token });
      const result = await provider.generate({ prompt: scene.videoPrompt || scene.description, imageBase64, durationSeconds: sceneClipDurationSeconds(selected), width: 1280, height: 704, fps: 24 });
      if (result.status !== "completed" || !result.outputUri) throw new Error(result.error || "O motor não retornou um clipe.");
      const localVideoUri = await persistGeneratedVideo(result.outputUri, selected.id, scene.title);
      const updated = { ...selected, finalVideoUri: undefined, finalVideoRemoteUri: undefined, scenes: selected.scenes.map(item => item.title === scene.title ? { ...item, videoUri: localVideoUri, videoRemoteUri: result.outputUri } : item) };
      saveUpdatedProject(updated);
      setVideoFeedback("Concluído: o clipe desta cena foi gerado e salvo no projeto.");
      showUserAlert("Clipe concluído", (result.message || "O clipe foi criado pelo motor do Estúdio 2D.") + " Você pode baixá-lo para o iPhone.");
    } catch (error) {
      const details = error instanceof Error ? error.message : "Falha desconhecida ao gerar o clipe.";
      const message = "Não foi possível animar esta cena. " + details + " Verifique a conexão do motor e tente novamente.";
      setVideoFeedback("Falha na animação: " + details);
      showUserAlert("Não foi possível animar", message);
    } finally {
      setBusyScene(null);
    }
  };

  const generateAllSceneImages = async () => {
    if (!selected) return;
    const connection = getEngineConnection();
    if (!connection) return;
    const pendingScenes = selected.scenes.filter(scene => !scene.imageUri);
    if (!pendingScenes.length) {
      setImageFeedback("Todas as cenas já possuem imagem. Você pode seguir para a animação.");
      return;
    }
    let workingProject = selected;
    let completed = 0;
    setImageFeedback(`Solicitação recebida. Preparando ${pendingScenes.length} imagens no servidor...`);
    setBatchProgress({ current: 0, total: pendingScenes.length });
    try {
      const provider = new HttpImageGenerationProvider({ baseUrl: connection.baseUrl, token: connection.token });
      for (const scene of pendingScenes) {
        setBusyScene(scene.title);
        setImageFeedback(`Gerando imagem ${completed + 1} de ${pendingScenes.length}: ${scene.title}. O motor remoto pode levar alguns minutos.`);
        const referenceScene = findCharacterReference(workingProject.scenes, scene.title);
        const referenceImageBase64 = referenceScene?.imageUri ? await imageUriToBase64(referenceScene.imageUri) : undefined;
        let result = await provider.generate({ prompt: scene.imagePrompt, width: 1024, height: 576, seed: stableProjectSeed(`${workingProject.id}:${scene.title}`), referenceImageBase64 });
        // Se o motor remoto rejeitar a referência visual, repetir sem a imagem-base
        // em vez de interromper toda a fila.
        if (
          result.status !== "completed" &&
          referenceImageBase64 &&
          /somente texto|referência.*não.*suportada|não.*suporta.*referência/i.test(result.error || "")
        ) {
          result = await provider.generate({ prompt: scene.imagePrompt, width: 1024, height: 576, seed: stableProjectSeed(`${workingProject.id}:${scene.title}`) });
        }
        if (result.status !== "completed" || !result.outputUri) throw new Error(`${scene.title}: ${result.error || "o motor não retornou uma imagem"}`);
        const localUri = await persistGeneratedImage(result.outputUri, workingProject.id, scene.title);
        workingProject = { ...workingProject, finalVideoUri: undefined, finalVideoRemoteUri: undefined, scenes: workingProject.scenes.map(item => item.title === scene.title ? { ...item, imageUri: localUri, videoUri: undefined, videoRemoteUri: undefined } : item) };
        completed += 1;
        setSelected(workingProject);
        setProjects(previous => previous.map(item => item.id === workingProject.id ? workingProject : item));
        setBatchProgress({ current: completed, total: pendingScenes.length });
      }
      setImageFeedback(`Concluído: ${completed} de ${pendingScenes.length} imagens foram geradas.`);
    } catch (error) {
      setImageFeedback(`Falha: ${completed} de ${pendingScenes.length} imagens concluídas. ${error instanceof Error ? error.message : "Falha desconhecida."}`);
    } finally {
      setBusyScene(null);
      setBatchProgress(null);
    }
  };

  const generateAllSceneVideos = async () => {
    if (!selected) return;
    const connection = getEngineConnection();
    if (!connection) return;
    const missingImages = selected.scenes.filter(scene => !scene.imageUri);
    if (missingImages.length) {
      Alert.alert("Faltam imagens", `Gere primeiro as imagens de todas as cenas. Ainda faltam ${missingImages.length}.`);
      return;
    }
    const pendingScenes = selected.scenes.filter(scene => !scene.videoUri);
    if (!pendingScenes.length) {
      Alert.alert("Animações prontas", "Todas as cenas já possuem clipe. Baixe os vídeos ou avance para a montagem final.");
      return;
    }
    let workingProject = selected;
    let completed = 0;
    let lastEngineMessage = "";
    setBatchProgress({ current: 0, total: pendingScenes.length });
    try {
      const provider = new HttpVideoGenerationProvider({ baseUrl: connection.baseUrl, token: connection.token });
      for (const scene of pendingScenes) {
        setBusyScene("video:" + scene.title);
        const imageBase64 = await imageUriToBase64(scene.imageUri!);
        const result = await provider.generate({ prompt: scene.videoPrompt || scene.description, imageBase64, durationSeconds: sceneClipDurationSeconds(workingProject), width: 1280, height: 704, fps: 24 });
        if (result.status !== "completed" || !result.outputUri) throw new Error(`${scene.title}: ${result.error || "o motor não retornou um clipe"}`);
        lastEngineMessage = result.message || "";
        const localVideoUri = await persistGeneratedVideo(result.outputUri, workingProject.id, scene.title);
        workingProject = { ...workingProject, finalVideoUri: undefined, finalVideoRemoteUri: undefined, scenes: workingProject.scenes.map(item => item.title === scene.title ? { ...item, videoUri: localVideoUri, videoRemoteUri: result.outputUri } : item) };
        completed += 1;
        setSelected(workingProject);
        setProjects(previous => previous.map(item => item.id === workingProject.id ? workingProject : item));
        setBatchProgress({ current: completed, total: pendingScenes.length });
      }
      Alert.alert("Clipes concluídos", `${completed} novos clipes foram criados. ${lastEngineMessage}`.trim());
    } catch (error) {
      Alert.alert("Geração interrompida", `${completed} de ${pendingScenes.length} clipes pendentes concluídos. ${error instanceof Error ? error.message : "Falha desconhecida."}`);
    } finally {
      setBusyScene(null);
      setBatchProgress(null);
    }
  };

  const downloadSceneVideo = async (scene: Scene) => {
    if (!scene.videoUri || !selected) return;
    const sourceUri = scene.videoRemoteUri || scene.videoUri;
    if (sourceUri.startsWith("file://")) {
      Alert.alert("Vídeo já está no aparelho", "Este clipe já foi salvo para assistir offline.");
      return;
    }
    setBusyScene(`download:${scene.title}`);
    try {
      const directory = `${FileSystem.documentDirectory}scene-videos/`;
      const directoryInfo = await FileSystem.getInfoAsync(directory);
      if (!directoryInfo.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      const safeName = scene.title.replace(/[^a-z0-9-_]/gi, "-").slice(0, 48) || "scene";
      const filenameParam = sourceUri.match(/[?&]filename=([^&]+)/)?.[1];
      const sourceFilename = filenameParam ? decodeURIComponent(filenameParam) : "";
      const extension = sourceFilename.match(/\.(mp4|webm|mov|mkv)$/i)?.[1] || "mp4";
      const destination = `${directory}${selected.id}-${safeName}-${Date.now()}.${extension}`;
      const result = await FileSystem.downloadAsync(sourceUri, destination);
      if (result.status < 200 || result.status >= 300) throw new Error(`O servidor retornou HTTP ${result.status}.`);
      const updated = {
        ...selected,
        scenes: selected.scenes.map(item => item.title === scene.title
          ? { ...item, videoRemoteUri: sourceUri, videoUri: result.uri }
          : item),
      };
      saveUpdatedProject(updated);
      Alert.alert("Vídeo salvo no iPhone", "Agora este clipe pode ser reproduzido sem manter conexão com o servidor.");
    } catch (error) {
      Alert.alert("Falha ao baixar", error instanceof Error ? error.message : "Não foi possível salvar o vídeo no aparelho.");
    } finally {
      setBusyScene(null);
    }
  };

  const downloadFinalVideo = async () => {
    if (!selected?.finalVideoRemoteUri) return;
    setBusyScene("download:final");
    try {
      const directory = `${FileSystem.documentDirectory}final-videos/`;
      const info = await FileSystem.getInfoAsync(directory);
      if (!info.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      const destination = `${directory}${selected.id}-final-${Date.now()}.mp4`;
      const result = await FileSystem.downloadAsync(selected.finalVideoRemoteUri, destination, {
        headers: engineConfig.renderToken ? { Authorization: `Bearer ${engineConfig.renderToken}` } : undefined,
      });
      if (result.status < 200 || result.status >= 300) throw new Error(`O servidor retornou HTTP ${result.status}.`);
      saveUpdatedProject({ ...selected, finalVideoUri: result.uri });
      Alert.alert("MP4 salvo no iPhone", "Agora você pode exportar o vídeo para Arquivos ou compartilhar.");
    } catch (error) {
      Alert.alert("Falha ao baixar o MP4", error instanceof Error ? error.message : "Tente novamente.");
    } finally {
      setBusyScene(null);
    }
  };

  const exportSceneVideo = async (scene: Scene) => {
    if (!scene.videoUri) return;
    if (!scene.videoUri.startsWith("file://")) {
      Alert.alert("Baixe primeiro", "Salve o clipe no iPhone antes de exportá-lo para Arquivos ou outro aplicativo.");
      return;
    }
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) throw new Error("O compartilhamento de arquivos não está disponível neste aparelho.");
      const extension = scene.videoUri.split("?")[0].split(".").pop()?.toLowerCase();
      const mimeType = extension === "webm" ? "video/webm" : extension === "mov" ? "video/quicktime" : "video/mp4";
      await Sharing.shareAsync(scene.videoUri, {
        mimeType,
        dialogTitle: "Exportar clipe",
        UTI: "public.movie",
      });
    } catch (error) {
      Alert.alert("Não foi possível exportar", error instanceof Error ? error.message : "Tente novamente.");
    }
  };

  const pickProjectAudio = async (kind: "narrationUri" | "musicUri") => {
    if (!selected) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: "audio/*", copyToCacheDirectory: true, multiple: false });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const extension = asset.name.split(".").pop()?.toLowerCase() || "";
      if (!["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(extension)) {
        Alert.alert("Formato não aceito", "Escolha um áudio MP3, WAV, M4A, AAC, OGG ou FLAC.");
        return;
      }
      const audioDirectory = (FileSystem.documentDirectory || "") + "project-audio/";
      const directoryInfo = await FileSystem.getInfoAsync(audioDirectory);
      if (!directoryInfo.exists) await FileSystem.makeDirectoryAsync(audioDirectory, { intermediates: true });
      const safeName = asset.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
      const permanentUri = audioDirectory + selected.id + "-" + kind + "-" + Date.now() + "-" + safeName;
      await FileSystem.copyAsync({ from: asset.uri, to: permanentUri });
      saveUpdatedProject({ ...selected, [kind]: permanentUri, finalVideoUri: undefined, finalVideoRemoteUri: undefined });
    } catch (error) {
      Alert.alert("Não foi possível selecionar o áudio", error instanceof Error ? error.message : "Tente novamente.");
    }
  };

  const loadTtsVoices = async () => {
    if (ttsLoading) return;
    let baseUrl = (engineConfig.renderBaseUrl || "").trim();
    while (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);
    const token = (engineConfig.renderToken || "").trim();
    if (!baseUrl || !token) {
      setTtsFeedback("Configure o endereço e o token do servidor em Conectar motor.");
      setShowSettings(true);
      return;
    }
    const previousScrollOffset = scrollOffsetRef.current;
    setTtsLoading(true);
    setTtsFeedback("Conectando ao servidor de voz…");
    try {
      const response = await fetch(baseUrl + "/tts/voices", {
        method: "GET",
        headers: { Authorization: "Bearer " + token, Accept: "application/json" },
      });
      const raw = await response.text();
      let payload: any = {};
      try { payload = raw ? JSON.parse(raw) : {}; }
      catch { throw new Error("O servidor respondeu em formato inesperado (HTTP " + response.status + ")."); }
      if (!response.ok) {
        const detail = typeof payload.detail === "string" ? payload.detail : "HTTP " + response.status;
        throw new Error(detail);
      }
      const voices = Array.isArray(payload.voices) ? payload.voices.filter((voice: unknown) => typeof voice === "string" && voice.trim()) as string[] : [];
      setTtsVoices(voices);
      if (voices.length) {
        if (!voices.includes(selectedTtsVoice)) setSelectedTtsVoice(voices[0]);
        setTtsFeedback(voices.length + " voz(es) carregada(s). Escolha uma voz para gerar a narração.");
      } else {
        setTtsFeedback("O servidor respondeu, mas não encontrou vozes instaladas. Verifique os modelos Piper no servidor.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao consultar o servidor Piper.";
      setTtsFeedback("Não foi possível carregar as vozes: " + message);
    } finally {
      setTtsLoading(false);
      // A lista de vozes altera a altura do conteúdo no navegador; restaura a posição
      // para o botão continuar visível em vez de mandar a página para o topo.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => scrollViewRef.current?.scrollTo({ y: previousScrollOffset, animated: false }));
      });
    }
  };

  const previewTtsVoice = async (voice: string) => {
    let baseUrl = (engineConfig.renderBaseUrl || "").trim();
    while (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);
    const token = (engineConfig.renderToken || "").trim();
    if (!baseUrl || !token) {
      setTtsFeedback("Configure o endereço e o token do servidor em Conectar motor para ouvir uma amostra.");
      setShowSettings(true);
      return;
    }
    setPreviewLoadingId(voice);
    setTtsFeedback("Gerando uma amostra curta de " + ttsVoiceLabel(voice) + "…");
    try {
      const response = await fetch(baseUrl + "/tts", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Olá! Esta é uma amostra da minha voz. Assim você pode me ouvir antes de me escolher para o seu personagem.",
          voice,
          duration_seconds: 5,
          length_scale: 1.18,
        }),
      });
      const payload = await response.json().catch(() => ({} as { detail?: string; download_url?: string }));
      if (!response.ok || !payload.download_url) throw new Error(payload.detail || "Não foi possível gerar a amostra desta voz.");
      const audioUrl = baseUrl + (payload.download_url.startsWith("/") ? payload.download_url : "/" + payload.download_url);
      const destination = (FileSystem.documentDirectory || "") + "project-audio/voice-preview-" + voice.replace(/[^a-zA-Z0-9_-]/g, "-") + "-" + Date.now() + ".wav";
      const audioUri = await downloadGeneratedAudio(audioUrl, token, destination);
      setVoicePreviewUri(audioUri);
      setVoicePreviewId(voice);
      setTtsFeedback("Amostra pronta! Toque no player para ouvir " + ttsVoiceLabel(voice) + ".");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao gerar amostra.";
      setTtsFeedback("Não foi possível ouvir esta voz: " + message);
    } finally {
      setPreviewLoadingId("");
    }
  };

  const generateSceneNarration = async (scene: Scene) => {
    if (!selected) return;
    const text = (scene.dialogue || "").trim();
    if (!text) { Alert.alert("Cena sem narração", "Escreva a narração desta cena antes de gerar o áudio."); return; }
    const voice = scene.voiceId || selectedTtsVoice;
    if (!voice) { Alert.alert("Escolha uma voz", "Carregue as vozes disponíveis e selecione uma voz."); return; }
    let baseUrl = (engineConfig.renderBaseUrl || "").trim();
    while (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);
    const token = (engineConfig.renderToken || "").trim();
    if (!baseUrl || !token) { Alert.alert("Configure a montagem", "Informe o endereço e o token do servidor nas configurações."); setShowSettings(true); return; }
    setBusyScene("tts:" + scene.title);
    setTtsFeedback("Gerando áudio somente para " + scene.title + "…");
    try {
      const response = await fetch(baseUrl + "/tts", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice, duration_seconds: sceneClipDurationSeconds(selected), length_scale: 1.18 }),
      });
      const payload = await response.json().catch(() => ({} as { detail?: string; download_url?: string }));
      if (!response.ok || !payload.download_url) throw new Error(payload.detail || "O servidor não conseguiu gerar o áudio desta cena.");
      const safeTitle = scene.title.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 40);
      const destination = (FileSystem.documentDirectory || "") + "project-audio/" + selected.id + "-" + safeTitle + "-" + Date.now() + ".wav";
      const audioUrl = baseUrl + (payload.download_url.startsWith("/") ? payload.download_url : "/" + payload.download_url);
      const audioUri = await downloadGeneratedAudio(audioUrl, token, destination);
      const updated = { ...selected, finalVideoUri: undefined, finalVideoRemoteUri: undefined, scenes: selected.scenes.map(item => item.title === scene.title ? { ...item, audioUri } : item) };
      saveUpdatedProject(updated);
      setTtsFeedback("Áudio da " + scene.title + " gerado e salvo.");
      Alert.alert("Áudio gerado", "O áudio desta cena está salvo. Você pode ouvi-lo no próprio cartão da cena.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível gerar o áudio desta cena.";
      setTtsFeedback("Falha em " + scene.title + ": " + message);
      Alert.alert("Falha ao gerar áudio", message);
    } finally {
      setBusyScene(null);
    }
  };

  const generateAiNarration = async () => {
    if (!selected) return;
    const sceneDuration = sceneClipDurationSeconds(selected);
    const segments = selected.scenes.map(scene => ({ text: (scene.dialogue || "").trim(), voice: scene.voiceId || selectedTtsVoice, duration_seconds: sceneDuration, length_scale: 1.18 }));
    if (!segments.some(segment => segment.text)) { Alert.alert("Roteiro sem narração", "Adicione o texto narrado às cenas antes de gerar o áudio."); return; }
    if (!selectedTtsVoice) { Alert.alert("Escolha uma voz", "Atualize a lista e selecione uma voz Piper disponível."); return; }
    let baseUrl = (engineConfig.renderBaseUrl || "").trim();
    while (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);
    const token = (engineConfig.renderToken || "").trim();
    if (!baseUrl || !token) { Alert.alert("Configure a montagem", "Informe o endereço e o token do servidor nas configurações."); setShowSettings(true); return; }
    setBusyScene("tts:project");
    try {
      const response = await fetch(baseUrl + "/tts/batch", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ segments }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.download_url) throw new Error(payload.detail || "O servidor não conseguiu gerar a voz.");
      const destination = (FileSystem.documentDirectory || "") + "project-audio/" + selected.id + "-ai-narration-" + Date.now() + ".wav";
      const audioUrl = baseUrl + (payload.download_url.startsWith("/") ? payload.download_url : "/" + payload.download_url);
      const audioUri = await downloadGeneratedAudio(audioUrl, token, destination);
      saveUpdatedProject({ ...selected, narrationUri: audioUri, finalVideoUri: undefined, finalVideoRemoteUri: undefined });
      setTtsFeedback("Narração gerada e salva! Use o player abaixo para ouvir.");
      Alert.alert("Narração gerada", "A voz foi criada e adicionada ao projeto. O player está na seção Áudio do projeto.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível gerar a narração.";
      setTtsFeedback("Falha na geração: " + message);
      Alert.alert("Falha na geração de voz", message);
    } finally {
      setBusyScene(null);
    }
  };

  const renderFinalVideo = async () => {
    if (!selected) return;
    const missingClips = selected.scenes.filter(scene => !scene.videoUri);
    if (missingClips.length) {
      Alert.alert("Faltam animações", `Ainda faltam ${missingClips.length} clipes. Gere todas as cenas antes de montar o MP4.`);
      return;
    }
    const renderBaseUrl = (engineConfig.renderBaseUrl || "").trim().replace(/\/+$/, "");
    const renderToken = (engineConfig.renderToken || "").trim();
    if (!renderBaseUrl || !renderToken) {
      Alert.alert("Configure a montagem", "Informe o endereço e o token do servidor de montagem nas configurações.");
      setShowSettings(true);
      return;
    }
    setBusyScene("render:final");
    setBatchProgress({ current: 0, total: selected.scenes.length });
    try {
      const directory = `${FileSystem.documentDirectory}final-videos/`;
      const directoryInfo = await FileSystem.getInfoAsync(directory);
      if (!directoryInfo.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });

      const form = new FormData();
      form.append("project_name", selected.title);
      let workingProject = selected;
      let narrationUri = selected.narrationUri;

      // Se o usuário ainda não escolheu uma narração, gere automaticamente
      // uma fala por cena com o Piper instalado no servidor.
      const hasDialogue = selected.scenes.some(scene => (scene.dialogue || "").trim().length > 0);
      if (!narrationUri && hasDialogue) {
        setBusyScene("tts:project");
        const voicesResponse = await fetch(`${renderBaseUrl}/tts/voices`, {
          headers: { Authorization: `Bearer ${renderToken}` },
        });
        const voicesPayload = await voicesResponse.json().catch(() => ({} as { detail?: string; voices?: string[] }));
        if (!voicesResponse.ok) {
          throw new Error(voicesPayload.detail || "Não foi possível consultar as vozes do servidor.");
        }
        const voices = Array.isArray(voicesPayload.voices) ? voicesPayload.voices : [];
        if (!voices.length) {
          throw new Error("O servidor ainda não disponibilizou uma voz em português. Aguarde a implantação do motor Piper.");
        }
        const defaultVoice = selectedTtsVoice || voices[0];
        const sceneDuration = sceneClipDurationSeconds(selected);
        const segments = selected.scenes.map(scene => ({
          text: (scene.dialogue || "").trim(),
          voice: scene.voiceId || defaultVoice,
          duration_seconds: sceneDuration,
        }));
        const ttsResponse = await fetch(`${renderBaseUrl}/tts/batch`, {
          method: "POST",
          headers: { Authorization: `Bearer ${renderToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ segments }),
        });
        const ttsPayload = await ttsResponse.json().catch(() => ({} as { detail?: string; download_url?: string }));
        if (!ttsResponse.ok || !ttsPayload.download_url) {
          throw new Error(ttsPayload.detail || "O servidor não conseguiu gerar a narração automática.");
        }
        const audioUrl = `${renderBaseUrl}${ttsPayload.download_url.startsWith("/") ? ttsPayload.download_url : `/${ttsPayload.download_url}`}`;
        const audioDirectory = `${FileSystem.documentDirectory}project-audio/`;
        const audioDirectoryInfo = await FileSystem.getInfoAsync(audioDirectory);
        if (!audioDirectoryInfo.exists) await FileSystem.makeDirectoryAsync(audioDirectory, { intermediates: true });
        const audioPath = `${audioDirectory}${selected.id}-auto-narration-${Date.now()}.wav`;
        const audioDownload = await FileSystem.downloadAsync(audioUrl, audioPath, {
          headers: { Authorization: `Bearer ${renderToken}` },
        });
        if (audioDownload.status < 200 || audioDownload.status >= 300) {
          throw new Error(`A narração foi gerada, mas o download falhou (HTTP ${audioDownload.status}).`);
        }
        narrationUri = audioDownload.uri;
        workingProject = { ...workingProject, narrationUri };
        saveUpdatedProject(workingProject);
      }
      setBusyScene("render:final");
      const appendAudio = async (uri: string | undefined, field: "narration" | "music") => {
        if (!uri) return;
        const extension = uri.split("?")[0].split(".").pop()?.toLowerCase() || "mp3";
        const mimeTypes: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", flac: "audio/flac" };
        form.append(field, { uri, name: field + "." + extension, type: mimeTypes[extension] || "application/octet-stream" } as any);
      };
      await appendAudio(narrationUri, "narration");
      await appendAudio(selected.musicUri, "music");

      for (let index = 0; index < selected.scenes.length; index += 1) {
        const scene = selected.scenes[index];
        let localUri = scene.videoUri!;
        if (!localUri.startsWith("file://")) {
          const sourceUri = scene.videoRemoteUri || localUri;
          const filenameParam = sourceUri.match(/[?&]filename=([^&]+)/)?.[1];
          const sourceFilename = filenameParam ? decodeURIComponent(filenameParam) : "";
          const extension = sourceFilename.match(/\.(mp4|webm|mov|mkv)$/i)?.[1] || "mp4";
          const localPath = `${directory}${selected.id}-scene-${String(index + 1).padStart(2, "0")}-${Date.now()}.${extension}`;
          const download = await FileSystem.downloadAsync(sourceUri, localPath);
          if (download.status < 200 || download.status >= 300) throw new Error(`Não foi possível baixar o clipe ${index + 1} (HTTP ${download.status}).`);
          localUri = download.uri;
          workingProject = {
            ...workingProject,
            scenes: workingProject.scenes.map(item => item.title === scene.title
              ? { ...item, videoUri: localUri, videoRemoteUri: sourceUri }
              : item),
          };
          setSelected(workingProject);
          setProjects(previous => previous.map(item => item.id === workingProject.id ? workingProject : item));
        }

        const extension = localUri.split("?")[0].split(".").pop()?.toLowerCase() || "mp4";
        const mimeType = extension === "webm" ? "video/webm" : extension === "mov" ? "video/quicktime" : extension === "mkv" ? "video/x-matroska" : "video/mp4";
        form.append("clips", { uri: localUri, name: `scene-${String(index + 1).padStart(2, "0")}.${extension}`, type: mimeType } as any);
        setBatchProgress({ current: index + 1, total: selected.scenes.length });
      }

      const response = await fetch(`${renderBaseUrl}/render`, {
        method: "POST",
        headers: { Authorization: `Bearer ${renderToken}` },
        body: form,
      });
      const payload = await response.json().catch(() => ({} as { detail?: string; download_url?: string; filename?: string }));
      if (!response.ok || !payload.download_url) {
        throw new Error(payload.detail || `Servidor de montagem respondeu HTTP ${response.status}.`);
      }

      const remoteFinalUri = `${renderBaseUrl}${payload.download_url.startsWith("/") ? payload.download_url : `/${payload.download_url}`}`;
      const finalPath = `${directory}${selected.id}-final-${Date.now()}.mp4`;
      let finalVideoUri = remoteFinalUri;
      let savedOnDevice = false;
      try {
        const finalDownload = await FileSystem.downloadAsync(remoteFinalUri, finalPath, {
          headers: { Authorization: `Bearer ${renderToken}` },
        });
        if (finalDownload.status < 200 || finalDownload.status >= 300) {
          throw new Error(`HTTP ${finalDownload.status}`);
        }
        finalVideoUri = finalDownload.uri;
        savedOnDevice = true;
      } catch (downloadError) {
        // A montagem já foi concluída no servidor. Não transforme uma falha
        // de cópia local em falha de renderização: mantenha o link remoto.
        console.warn("MP4 montado, mas não foi possível copiá-lo para o aparelho:", downloadError);
      }
      const completedProject = {
        ...workingProject,
        finalVideoUri,
        finalVideoRemoteUri: remoteFinalUri,
      };
      saveUpdatedProject(completedProject);
      Alert.alert(
        "MP4 final pronto",
        savedOnDevice
          ? "O vídeo foi montado e salvo no iPhone." + (narrationUri || selected.musicUri ? " Narração e/ou música foram incluídas." : "")
          : "O vídeo foi montado no servidor, mas não foi possível copiá-lo para o iPhone. O link remoto foi mantido para você assistir ou tentar baixar novamente."
      );
    } catch (error) {
      Alert.alert("Falha na montagem", error instanceof Error ? error.message : "Não foi possível montar o MP4 final.");
    } finally {
      setBusyScene(null);
      setBatchProgress(null);
    }
  };

  const openSceneVideo = async (uri: string) => {
    try { await Linking.openURL(uri); }
    catch { Alert.alert("Não foi possível abrir", "Verifique se o endereço do vídeo está acessível no celular."); }
  };

  const currentScript = useMemo(() => selected ? projectText(selected) : "", [selected]);

  const createProject = async () => {
    const cleanIdea = idea.trim();
    if (!cleanIdea) {
      setStoryFeedback("Escreva sua ideia no campo acima antes de criar a história.");
      return;
    }
    if (creatingStory) return;
    setCreatingStory(true);
    setStoryFeedback("Conectando ao servidor e solicitando o roteiro à IA. Em uma primeira tentativa, o servidor pode levar até 1 minuto para despertar.");
    try {
      const baseUrl = (engineConfig.renderBaseUrl || "").trim().replace(new RegExp("/+$"), "");
      const token = (engineConfig.renderToken || "").trim();
      if (!isAllowedEngineUrl(baseUrl) || !token) {
        throw new Error("Conexão incompleta. Abra as configurações e conecte o motor do Estúdio 2D.");
      }
      const response = await fetch(`${baseUrl}/v1/stories/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          idea: cleanIdea,
          genre,
          duration,
          character: "Personagem principal a definir. Manter rosto, cabelo, roupa, proporções e paleta consistentes em todas as cenas."
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.detail || `Falha ao gerar história (HTTP ${response.status}).`);
      }
      const generatedPlan = result as StoryPlan;
      if (!Array.isArray(generatedPlan.scenes) || generatedPlan.scenes.length < 4) {
        throw new Error("A IA respondeu, mas não entregou as cenas necessárias. Tente novamente.");
      }
      const project = { ...buildProject(cleanIdea, genre, duration, generatedPlan), storyEngine: "ai-provider" as const };
      setProjects(previous => [project, ...previous]);
      setSelected(project);
      setIdea("");
      setStoryFeedback(`Roteiro criado pela IA com ${project.scenes.length} cenas. O projeto já está aberto para edição.`);
    } catch (error) {
      // Não deixe a ação principal parecer que não fez nada quando o servidor
      // remoto estiver ausente, dormindo ou sem provedor de IA configurado.
      // Crie um projeto local claramente identificado como modelo, sem alegar
      // que houve geração por IA.
      const project = { ...buildProject(cleanIdea, genre, duration), storyEngine: "local-template" as const };
      setProjects(previous => [project, ...previous]);
      setSelected(project);
      setIdea("");
      const reason = error instanceof Error ? error.message : "Servidor de IA indisponível.";
      setStoryFeedback(`Projeto criado com roteiro-base local (${project.scenes.length} cenas). A IA remota não respondeu: ${reason} Você já pode editar o projeto; a geração por IA será ativada quando o servidor estiver conectado.`);
    } finally {
      setCreatingStory(false);
    }
  };

  const copyScript = async () => {
    if (!selected) return;
    await Clipboard.setStringAsync(currentScript);
    Alert.alert("Copiado!", "O roteiro foi copiado para a área de transferência.");
  };

  const shareScript = async () => {
    if (!selected) return;
    try {
      await Share.share({ title: selected.title, message: currentScript });
    } catch {
      Alert.alert("Não foi possível compartilhar", "Tente novamente.");
    }
  };

  const removeProject = (id: string) => {
    setProjects(previous => previous.filter(item => item.id !== id));
    if (selected?.id === id) setSelected(null);
  };

  const deleteProject = (id: string) => {
    // Alert.alert não executa os botões de confirmação de forma consistente no navegador.
    if (Platform.OS === "web" && typeof window !== "undefined") {
      if (window.confirm("Excluir este projeto? Ele será removido deste aparelho.")) removeProject(id);
      return;
    }
    Alert.alert("Excluir projeto?", "Essa ação remove o projeto salvo neste aparelho.", [
      { text: "Cancelar", style: "cancel" },
      { text: "Excluir", style: "destructive", onPress: () => removeProject(id) }
    ]);
  };

  const deleteAllProjects = () => {
    if (!projects.length) return;
    const removeAll = () => {
      setProjects([]);
      setSelected(null);
    };
    if (Platform.OS === "web" && typeof window !== "undefined") {
      if (window.confirm("Apagar todos os projetos salvos neste aparelho? Esta ação não pode ser desfeita.")) removeAll();
      return;
    }
    Alert.alert("Apagar todos os projetos?", "Esta ação remove todas as histórias salvas neste aparelho.", [
      { text: "Cancelar", style: "cancel" },
      { text: "Apagar tudo", style: "destructive", onPress: removeAll }
    ]);
  };

  const startNew = () => {
    setSelected(null);
    setIdea("");
    setStoryFeedback("");
    setImageFeedback("");
    setVideoFeedback("");
    setTtsFeedback("");
    setBatchProgress(null);
    // Não altera nem apaga engineConfig, token ou conexão salva.
  };

  const saveUpdatedProject = (updated: Project) => {
    setSelected(updated);
    setProjects(previous => previous.map(item => item.id === updated.id ? updated : item));
  };

  const updateCharacter = (value: string) => {
    if (!selected) return;
    const updated: Project = {
      ...selected,
      character: value,
      finalVideoUri: undefined,
      finalVideoRemoteUri: undefined,
      scenes: selected.scenes.map(scene => ({
        ...scene,
        imagePrompt: updateCharacterInPrompt(scene.imagePrompt || "", selected.character, value),
        videoPrompt: updateCharacterInPrompt(scene.videoPrompt || "", selected.character, value),
        imageUri: undefined,
        videoUri: undefined,
        videoRemoteUri: undefined,
      }))
    };
    saveUpdatedProject(updated);
  };

  const restoreVoiceSelectionScroll = (offset: number) => {
    // Reaplica a posição após o React Native Web concluir a atualização
    // dos cartões e também após o navegador recalcular o layout.
    const restore = () => {
      scrollViewRef.current?.scrollTo({ y: offset, animated: false });
      scrollOffsetRef.current = offset;
    };
    requestAnimationFrame(() => requestAnimationFrame(restore));
    setTimeout(restore, 120);
    setTimeout(restore, 280);
  };

  const selectProjectVoice = (voiceId: string) => {
    const offset = scrollOffsetRef.current;
    setSelectedTtsVoice(voiceId);
    restoreVoiceSelectionScroll(offset);
  };

  const updateSceneVoice = (sceneTitle: string, voiceId: string) => {
    if (!selected) return;
    const offset = scrollOffsetRef.current;
    saveUpdatedProject({ ...selected, scenes: selected.scenes.map(scene => scene.title === sceneTitle ? { ...scene, voiceId } : scene) });
    restoreVoiceSelectionScroll(offset);
  };

  const updateScene = (sceneTitle: string, field: "description" | "dialogue" | "imagePrompt" | "videoPrompt", value: string) => {
    if (!selected) return;
    saveUpdatedProject({
      ...selected,
      finalVideoUri: undefined,
      finalVideoRemoteUri: undefined,
      scenes: selected.scenes.map(scene => {
        if (scene.title !== sceneTitle) return scene;
        const changed = { ...scene, [field]: value };
        if (field === "imagePrompt" || field === "description") {
          return { ...changed, imageUri: undefined, videoUri: undefined, videoRemoteUri: undefined };
        }
        if (field === "videoPrompt") {
          return { ...changed, videoUri: undefined, videoRemoteUri: undefined };
        }
        return changed;
      })
    });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#101018" />
      <ScrollView ref={scrollViewRef} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" scrollEventThrottle={16} onScroll={event => { scrollOffsetRef.current = event.nativeEvent.contentOffset.y; }}>
        <View style={styles.header}>
          <View style={styles.logo}><Text style={styles.logoText}>✦</Text></View>
          <View style={styles.brandWrap}>
            <Text style={styles.brand}>ESTÚDIO <Text style={styles.brandAccent}>2D</Text></Text>
            <Text style={styles.subtitle}>SEU UNIVERSO DE ANIMAÇÃO</Text>
          </View>
          <View style={styles.privatePill}><Text style={styles.privateText}>PESSOAL</Text></View>
        </View>

        <View style={styles.panel}>
          <Text style={styles.step}>ESTÚDIO 2D · PRÉVIA DE DESENVOLVIMENTO</Text>
          <Text style={styles.panelTitle}>Seu espaço de criação</Text>
          <Text style={styles.note}>Você já pode organizar ideias, personagens e cenas. A geração de imagens será ativada quando o servidor e o motor remoto de imagens estiverem configurados; o servidor não precisa ter GPU própria para usar o Hugging Face ZeroGPU.</Text>
        </View>

        <View style={styles.hero}>
          <Text style={styles.eyebrow}>IDEIAS QUE GANHAM VIDA</Text>
          <Text style={styles.heading}>Crie sua próxima{"\n"}<Text style={styles.headingAccent}>animação.</Text></Text>
          <Text style={styles.intro}>Seu espaço para desenvolver histórias, personagens e cenas.</Text>
        </View>

        <TouchableOpacity style={styles.secondary} onPress={() => setShowSettings(value => !value)}>
          <Text style={styles.secondaryText}>{showSettings ? "FECHAR CONEXÃO DO MOTOR" : "CONECTAR MOTOR DO ESTÚDIO 2D"}</Text>
        </TouchableOpacity>
        {showSettings ? <View style={styles.panel}>
          <Text style={styles.step}>CONEXÃO SEGURA</Text>
          <Text style={styles.panelTitle}>Motor próprio do Estúdio 2D</Text>
          <Text style={styles.note}>O aplicativo conversa diretamente com a API do estúdio. Não precisa de ComfyUI, workflows ou plugins. Para imagens, o servidor pode chamar um Space do Hugging Face ZeroGPU, sujeito a fila e cota gratuita limitada. Atenção: esse Space não gera vídeos. Sem um servidor separado com GPU compatível e Wan2.2 configurado, o vídeo disponível usa apenas movimento de câmera sobre uma imagem estática; não anima personagens.</Text>
          <Text style={styles.label}>ENDEREÇO HTTPS DO SERVIDOR</Text>
          <TextInput value={engineConfig.renderBaseUrl || ""} onChangeText={value => setEngineConfig(previous => ({ ...previous, renderBaseUrl: value }))} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://seu-servidor-do-estudio" placeholderTextColor="#777789" style={styles.smallInput} />
          <Text style={styles.label}>TOKEN DE ACESSO</Text>
          <TextInput value={engineConfig.renderToken || ""} onChangeText={value => setEngineConfig(previous => ({ ...previous, renderToken: value }))} autoCapitalize="none" autoCorrect={false} secureTextEntry placeholder="Token privado do servidor" placeholderTextColor="#777789" style={styles.smallInput} />
          <TouchableOpacity style={styles.primary} onPress={saveEngineConfig}><Text style={styles.primaryText}>SALVAR CONEXÃO</Text><Text style={styles.arrow}>✓</Text></TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={testRenderConnection}><Text style={styles.secondaryText}>TESTAR CONEXÃO DO MOTOR</Text></TouchableOpacity>
          <Text style={styles.note}>Status: {connectionStatus}. O endereço e o token são guardados no aparelho; o token fica no armazenamento seguro.</Text>
        </View> : null}

        {!selected ? <>
          <View style={styles.panel}>
            <Text style={styles.step}>01 / NOVO PROJETO</Text>
            <Text style={styles.panelTitle}>Qual é a sua ideia?</Text>
            <TextInput value={idea} onChangeText={setIdea} multiline maxLength={700}
              placeholder="Ex.: Um garoto encontra um portal secreto e conhece um pequeno dragão..."
              placeholderTextColor="#777789" style={styles.input} textAlignVertical="top" />
            <Text style={styles.counter}>{idea.length}/700 caracteres</Text>

            <Text style={styles.label}>ESTILO DA HISTÓRIA</Text>
            <View style={styles.chips}>{genres.map(item => (
              <TouchableOpacity key={item} onPress={() => setGenre(item)} style={[styles.chip, genre === item && styles.chipActive]}>
                <Text style={[styles.chipText, genre === item && styles.chipTextActive]}>{item}</Text>
              </TouchableOpacity>
            ))}</View>

            <Text style={styles.label}>DURAÇÃO DESEJADA</Text>
            <View style={styles.chips}>{durations.map(item => (
              <TouchableOpacity key={item} onPress={() => setDuration(item)} style={[styles.chip, duration === item && styles.chipActive]}>
                <Text style={[styles.chipText, duration === item && styles.chipTextActive]}>{item}</Text>
              </TouchableOpacity>
            ))}</View>

            <TouchableOpacity style={styles.primary} onPress={createProject} onPressIn={() => setStoryFeedback("Toque recebido. Iniciando a criação do roteiro...")} disabled={creatingStory} activeOpacity={0.75} accessibilityRole="button">
              <Text style={styles.primaryText}>{creatingStory ? "GERANDO ROTEIRO... AGUARDE" : "✦  CRIAR HISTÓRIA E PREENCHER CENAS"}</Text><Text style={styles.arrow}>{creatingStory ? "…" : "→"}</Text>
            </TouchableOpacity>
            {!!storyFeedback && <Text accessibilityLiveRegion="polite" style={styles.note}>{storyFeedback}</Text>}
            <Text style={styles.note}>A IA cria o roteiro original pelo servidor conectado. A geração de imagens, animações e vozes depende dos respectivos motores hospedados.</Text>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>MEUS PROJETOS</Text>
            <Text style={styles.projectCount}>{projects.length} salvo(s)</Text>
          </View>
          {projects.length > 0 ? <TouchableOpacity onPress={deleteAllProjects} style={styles.deleteAllButton}>
            <Text style={styles.deleteText}>APAGAR TODOS OS PROJETOS</Text>
          </TouchableOpacity> : null}
          {!ready ? <Text style={styles.empty}>Carregando seus projetos…</Text> :
            projects.length === 0 ? <Text style={styles.empty}>Seus projetos criados aparecerão aqui.</Text> :
            projects.map(item => (
              <View key={item.id} style={styles.projectRow}>
                <TouchableOpacity style={styles.projectOpen} onPress={() => setSelected(item)}>
                  <Text style={styles.projectName}>{item.title}</Text>
                  <Text style={styles.projectMeta}>{item.genre} · {item.duration}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => deleteProject(item.id)} style={styles.deleteButton}>
                  <Text style={styles.deleteText}>Excluir</Text>
                </TouchableOpacity>
              </View>
            ))
          }
        </> : <>
          <TouchableOpacity onPress={startNew} disabled={!!busyScene} style={styles.backButton}><Text style={styles.backText}>‹  INÍCIO · CRIAR OUTRA HISTÓRIA</Text></TouchableOpacity>
          <View style={styles.panel} pointerEvents={busyScene ? "none" : "auto"}>
            <Text style={styles.step}>PROJETO SALVO NO APARELHO</Text>
            <Text style={styles.panelTitle}>{selected.title}</Text>
            <Text style={styles.projectMeta}>{selected.genre} · {selected.duration} · {selected.scenes.length} cenas · {selected.storyEngine === "ai-provider" ? "roteiro por IA" : "planejamento local"}</Text>
            <TouchableOpacity onPress={() => deleteProject(selected.id)} style={styles.deleteAllButton}>
              <Text style={styles.deleteText}>EXCLUIR ESTA HISTÓRIA</Text>
            </TouchableOpacity>
            <Text style={styles.label}>IDEIA ORIGINAL</Text>
            <Text style={styles.body}>{selected.idea}</Text>
            <Text style={styles.label}>FICHA DO PERSONAGEM</Text>
            <TextInput value={selected.character} onChangeText={updateCharacter} multiline textAlignVertical="top" placeholder="Descreva aparência, roupa, personalidade e voz do personagem..." placeholderTextColor="#777789" style={styles.characterInput} />
            <Text style={styles.note}>A ficha do personagem entra nos prompts. Quando disponível, a primeira imagem gerada também é usada como referência nas cenas seguintes; isso ajuda, mas não garante identidade idêntica.</Text>
            {selected.scenes.map(scene => <View key={scene.title} style={styles.scene}>
              <Text style={styles.sceneTitle}>{scene.title}</Text>
              {scene.imageUri ? <><View style={styles.statusPill}><Text style={styles.statusReady}>✓ IMAGEM PRONTA</Text></View><Image source={{ uri: scene.imageUri }} style={styles.generatedImage} resizeMode="cover" /></> : <View style={styles.imagePlaceholder}><Text style={styles.note}>{busyScene === scene.title ? "GERANDO IMAGEM… aguarde a conclusão" : "IMAGEM PENDENTE · esta cena ainda não foi gerada"}</Text></View>}
              <TouchableOpacity style={styles.secondary} onPress={() => generateSceneImage(scene)} disabled={!!busyScene || !!batchProgress}><Text style={styles.secondaryText}>{busyScene === scene.title ? "GERANDO IMAGEM…" : "GERAR IMAGEM DESTA CENA"}</Text></TouchableOpacity>
              <TouchableOpacity style={styles.primary} onPress={() => generateSceneVideo(scene)} disabled={!!busyScene || !!batchProgress || !scene.imageUri}><Text style={styles.primaryText}>{busyScene === "video:" + scene.title ? "ANIMANDO CENA…" : "ANIMAR ESTA CENA"}</Text><Text style={styles.arrow}>▶</Text></TouchableOpacity>
              {videoFeedback ? <Text accessibilityLiveRegion="polite" style={styles.note}>{videoFeedback}</Text> : null}
              {scene.videoUri ? <><SceneVideoPlayer uri={scene.videoUri} /><TouchableOpacity style={styles.secondary} disabled={busyScene === `download:${scene.title}`} onPress={() => downloadSceneVideo(scene)}><Text style={styles.secondaryText}>{busyScene === `download:${scene.title}` ? "SALVANDO NO IPHONE…" : scene.videoUri.startsWith("file://") ? "VÍDEO SALVO OFFLINE" : "BAIXAR VÍDEO PARA O IPHONE"}</Text></TouchableOpacity><TouchableOpacity style={styles.secondary} onPress={() => openSceneVideo(scene.videoRemoteUri || scene.videoUri!)}><Text style={styles.secondaryText}>ABRIR VÍDEO NO NAVEGADOR</Text></TouchableOpacity>{scene.videoUri.startsWith("file://") ? <TouchableOpacity style={styles.secondary} onPress={() => exportSceneVideo(scene)}><Text style={styles.secondaryText}>EXPORTAR PARA ARQUIVOS / COMPARTILHAR</Text></TouchableOpacity> : null}</> : null}
              <Text style={styles.label}>AÇÃO DA CENA</Text>
              <TextInput value={scene.description} onChangeText={value => updateScene(scene.title, "description", value)} multiline textAlignVertical="top" placeholder="Descreva o que acontece nesta cena..." placeholderTextColor="#777789" style={styles.sceneInput} />
              <Text style={styles.label}>FALA / DIÁLOGO</Text>
              <TextInput value={scene.dialogue} onChangeText={value => updateScene(scene.title, "dialogue", value)} multiline textAlignVertical="top" placeholder="Texto narrado por uma voz externa, sem falas dos personagens..." placeholderTextColor="#777789" style={styles.sceneInput} />
              {ttsVoices.length ? <><Text style={styles.label}>VOZ DESTA CENA</Text><View style={styles.chips}>{ttsVoices.map(voice => <TouchableOpacity key={voice} style={[styles.chip, (scene.voiceId || selectedTtsVoice) === voice && styles.chipActive]} onPress={() => updateSceneVoice(scene.title, voice)}><Text style={[styles.chipText, (scene.voiceId || selectedTtsVoice) === voice && styles.chipTextActive]}>{ttsVoiceLabel(voice)}</Text></TouchableOpacity>)}</View></> : null}
              <TouchableOpacity style={styles.primary} onPress={() => generateSceneNarration(scene)} disabled={!!busyScene || !!batchProgress || !ttsVoices.length}>
                <Text style={styles.primaryText}>{busyScene === "tts:" + scene.title ? "GERANDO ÁUDIO DESTA CENA…" : scene.audioUri ? "GERAR ÁUDIO DESTA CENA NOVAMENTE" : "GERAR ÁUDIO DESTA CENA"}</Text><Text style={styles.arrow}>♫</Text>
              </TouchableOpacity>
              {scene.audioUri ? <><Text style={styles.label}>ÁUDIO DESTA CENA</Text><NarrationAudioPlayer uri={scene.audioUri} /><TouchableOpacity style={styles.secondary} onPress={() => saveUpdatedProject({ ...selected, finalVideoUri: undefined, finalVideoRemoteUri: undefined, scenes: selected.scenes.map(item => item.title === scene.title ? { ...item, audioUri: undefined } : item) })}><Text style={styles.secondaryText}>REMOVER ÁUDIO DESTA CENA</Text></TouchableOpacity></> : null}
              <Text style={styles.label}>ENQUADRAMENTO · {(scene.shot || "plano médio").toUpperCase()}</Text>
              <Text style={styles.body}>Câmera: {scene.camera}{"\n"}Luz: {scene.lighting}</Text>
              <Text style={styles.label}>PROMPT VISUAL · EDITÁVEL</Text>
              <TextInput value={scene.imagePrompt || ""} onChangeText={value => updateScene(scene.title, "imagePrompt", value)} multiline textAlignVertical="top" placeholder="Descreva a aparência da cena, cenário, personagem e iluminação..." placeholderTextColor="#777789" style={styles.promptInput} />
              <Text style={styles.label}>PROMPT DE ANIMAÇÃO · EDITÁVEL</Text>
              <TextInput value={scene.videoPrompt || ""} onChangeText={value => updateScene(scene.title, "videoPrompt", value)} multiline textAlignVertical="top" placeholder="Descreva os movimentos, expressões e movimentos de câmera..." placeholderTextColor="#777789" style={styles.promptInput} />
            </View>)}
            <View style={styles.timelinePanel}>
              <Text style={styles.step}>LINHA DO TEMPO</Text>
              <Text style={styles.panelTitle}>Animação das cenas</Text>
              <Text style={styles.body}>{selected.scenes.filter(scene => !!scene.videoUri).length} de {selected.scenes.length} clipes gerados · {selected.scenes.filter(scene => !!scene.imageUri).length} imagens prontas · {selected.scenes.filter(scene => !scene.imageUri).length} imagens pendentes</Text>
              <TouchableOpacity style={styles.secondary} onPress={generateAllSceneImages} onPressIn={() => setImageFeedback("Toque recebido. Preparando a geração das imagens...")} disabled={!!busyScene || !!batchProgress}>
                <Text style={styles.secondaryText}>GERAR TODAS AS IMAGENS</Text>
              </TouchableOpacity>
              {imageFeedback ? <Text accessibilityLiveRegion="polite" style={styles.note}>{imageFeedback}</Text> : null}
              {batchProgress ? <View style={styles.progressPanel}>
                <Text style={styles.progressTitle}>{busyScene?.startsWith("video:") ? "ANIMAÇÃO EM ANDAMENTO" : "GERAÇÃO DE IMAGENS EM ANDAMENTO"}</Text>
                <Text style={styles.note}>{batchProgress.current} de {batchProgress.total} concluídas · {Math.round((batchProgress.current / Math.max(batchProgress.total, 1)) * 100)}%</Text>
                <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.round((batchProgress.current / Math.max(batchProgress.total, 1)) * 100)}%` }]} /></View>
                <Text style={styles.note}>Cena atual: {busyScene?.replace(/^video:/, "") || "Preparando próxima cena"}</Text>
              </View> : null}
              <TouchableOpacity style={styles.primary} onPress={generateAllSceneVideos} disabled={!!busyScene || !!batchProgress || selected.scenes.some(scene => !scene.imageUri)}>
                <Text style={styles.primaryText}>ANIMAR TODAS AS CENAS</Text><Text style={styles.arrow}>▶</Text>
              </TouchableOpacity>
              <Text style={styles.note}>Duração planejada dos clipes: {estimatedGeneratedDurationSeconds(selected).toFixed(1)} segundos ({sceneClipDurationSeconds(selected).toFixed(2)} s por cena). Cada clipe respeita o limite de 5 segundos; a duração final pode variar alguns quadros conforme a taxa de 24 FPS e o motor utilizado. O app não exige workflows ou ComfyUI. As imagens podem usar o Space remoto Hugging Face ZeroGPU (com cota diária limitada). A animação pode criar clipes com movimento de câmera pelo FFmpeg mesmo sem GPU; movimentos reais dos personagens ainda dependem de um modelo de vídeo como Wan2.2 e de uma GPU compatível.</Text>
              <Text style={styles.step}>ÁUDIO DO PROJETO</Text>
              <Text style={styles.note}>Adicione uma narração e/ou música de fundo. A voz será mixada em volume normal e a música em volume reduzido.</Text>
              <Text style={styles.note}>Carregue as vozes instaladas no servidor para gerar uma narração por cena. Você também pode usar um arquivo de áudio próprio.</Text>
              <TouchableOpacity style={styles.secondary} onPress={loadTtsVoices} disabled={!!busyScene || !!batchProgress || ttsLoading}><Text style={styles.secondaryText}>{ttsLoading ? "CARREGANDO VOZES…" : "CARREGAR VOZES DISPONÍVEIS"}</Text></TouchableOpacity>
              {ttsFeedback ? <Text accessibilityLiveRegion="polite" style={styles.note}>{ttsFeedback}</Text> : null}
              {ttsVoices.length ? <View style={{ gap: 10 }}>
                {ttsVoices.map(voice => <View key={voice} style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: selectedTtsVoice === voice ? "#8b5cf6" : "#343447", backgroundColor: selectedTtsVoice === voice ? "#211a35" : "#171722", gap: 8 }}>
                  <TouchableOpacity onPress={() => selectProjectVoice(voice)}>
                    <Text style={[styles.chipText, selectedTtsVoice === voice && styles.chipTextActive]}>{selectedTtsVoice === voice ? "✓ " : ""}{ttsVoiceLabel(voice)}</Text>
                    <Text style={styles.note}>{selectedTtsVoice === voice ? "Voz selecionada para a narração do projeto" : "Toque para selecionar esta voz"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.secondary} onPress={() => previewTtsVoice(voice)} disabled={!!previewLoadingId || !!busyScene || !!batchProgress}>
                    <Text style={styles.secondaryText}>{previewLoadingId === voice ? "GERANDO AMOSTRA…" : "▶ OUVIR AMOSTRA DESTA VOZ"}</Text>
                  </TouchableOpacity>
                  {voicePreviewId === voice && voicePreviewUri ? <NarrationAudioPlayer uri={voicePreviewUri} /> : null}
                </View>)}
              </View> : null}
              <TouchableOpacity style={styles.primary} onPress={generateAiNarration} disabled={!!busyScene || !!batchProgress || !ttsVoices.length}>
                <Text style={styles.primaryText}>{busyScene === "tts:project" ? "GERANDO NARRAÇÃO…" : "GERAR NARRAÇÃO COMPLETA (TODAS AS CENAS)"}</Text><Text style={styles.arrow}>♫</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondary} onPress={() => pickProjectAudio("narrationUri")} disabled={!!busyScene || !!batchProgress}><Text style={styles.secondaryText}>{selected.narrationUri ? "NARRAÇÃO SELECIONADA · " + selected.narrationUri.split("/").pop() : "ESCOLHER NARRAÇÃO"}</Text></TouchableOpacity>
              {selected.narrationUri ? <><Text style={styles.label}>OUVIR NARRAÇÃO GERADA</Text><NarrationAudioPlayer uri={selected.narrationUri} /><TouchableOpacity style={styles.secondary} onPress={() => saveUpdatedProject({ ...selected, narrationUri: undefined, finalVideoUri: undefined, finalVideoRemoteUri: undefined })}><Text style={styles.secondaryText}>REMOVER NARRAÇÃO</Text></TouchableOpacity></> : null}
              <TouchableOpacity style={styles.secondary} onPress={() => pickProjectAudio("musicUri")} disabled={!!busyScene || !!batchProgress}><Text style={styles.secondaryText}>{selected.musicUri ? "MÚSICA SELECIONADA · " + selected.musicUri.split("/").pop() : "ESCOLHER MÚSICA DE FUNDO"}</Text></TouchableOpacity>
              {selected.musicUri ? <TouchableOpacity style={styles.secondary} onPress={() => saveUpdatedProject({ ...selected, musicUri: undefined, finalVideoUri: undefined, finalVideoRemoteUri: undefined })}><Text style={styles.secondaryText}>REMOVER MÚSICA</Text></TouchableOpacity> : null}
              <TouchableOpacity style={styles.primary} onPress={renderFinalVideo} disabled={!!busyScene || !!batchProgress || selected.scenes.some(scene => !scene.videoUri)}>
                <Text style={styles.primaryText}>{busyScene === "render:final" ? "MONTANDO VÍDEO FINAL…" : "MONTAR VÍDEO FINAL EM MP4"}</Text><Text style={styles.arrow}>▣</Text>
              </TouchableOpacity>
              {selected.finalVideoUri ? <>
                <Text style={styles.label}>VÍDEO COMPLETO DO PROJETO</Text>
                {selected.finalVideoUri.startsWith("file://")
                  ? <SceneVideoPlayer uri={selected.finalVideoUri} />
                  : <Text style={styles.note}>O MP4 está pronto no servidor. Baixe-o para o iPhone para assistir e compartilhar.</Text>}
                {!selected.finalVideoUri.startsWith("file://") ? <TouchableOpacity style={styles.secondary} disabled={!!busyScene} onPress={downloadFinalVideo}><Text style={styles.secondaryText}>{busyScene === "download:final" ? "BAIXANDO MP4…" : "BAIXAR MP4 PARA O IPHONE"}</Text></TouchableOpacity> : null}
                <TouchableOpacity style={styles.secondary} onPress={async () => {
                  if (!selected.finalVideoUri?.startsWith("file://")) {
                    Alert.alert("Arquivo indisponível", "Baixe primeiro o MP4 final para exportá-lo.");
                    return;
                  }
                  try {
                    await Sharing.shareAsync(selected.finalVideoUri, { mimeType: "video/mp4", dialogTitle: "Exportar MP4 final", UTI: "public.movie" });
                  } catch (error) {
                    Alert.alert("Não foi possível exportar", error instanceof Error ? error.message : "Tente novamente.");
                  }
                }}>
                  <Text style={styles.secondaryText}>EXPORTAR MP4 FINAL PARA ARQUIVOS</Text>
                </TouchableOpacity>
              </> : null}
              <Text style={styles.note}>A montagem concatena os clipes em 1024×576, 30 FPS e H.264. Narração e música podem ser anexadas acima; transições ainda serão adicionadas em uma etapa própria.</Text>
            </View>
            <TouchableOpacity style={styles.primary} onPress={copyScript}>
              <Text style={styles.primaryText}>COPIAR ROTEIRO</Text><Text style={styles.arrow}>⧉</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={async () => { const prompts = selected.scenes.map(scene => scene.imagePrompt + "\n\n" + scene.videoPrompt).join("\n\n---\n\n"); await Clipboard.setStringAsync(prompts); Alert.alert("Prompts copiados", "Os prompts visuais e de animação foram copiados."); }}>
              <Text style={styles.secondaryText}>COPIAR PROMPTS VISUAIS</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={shareScript}>
              <Text style={styles.secondaryText}>COMPARTILHAR / EXPORTAR TEXTO</Text>
            </TouchableOpacity>
          </View>
        </>}

        <Text style={styles.footer}>ESTÚDIO 2D  ·  APLICATIVO PARA iOS E ANDROID</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#101018" },
  container: { padding: 20, paddingBottom: 48 },
  header: { flexDirection: "row", alignItems: "center", gap: 11, marginTop: 8 },
  logo: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#8B5CF6", alignItems: "center", justifyContent: "center" },
  logoText: { color: "#fff", fontSize: 25 },
  brandWrap: { flex: 1 },
  brand: { color: "#F5F3FF", fontSize: 15, fontWeight: "900", letterSpacing: 2 },
  brandAccent: { color: "#A78BFA" },
  subtitle: { color: "#88869A", fontSize: 9, letterSpacing: 1.3, marginTop: 3 },
  privatePill: { borderColor: "#514174", borderWidth: 1, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 6 },
  privateText: { color: "#C4B5FD", fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  hero: { marginTop: 38, marginBottom: 24 },
  eyebrow: { color: "#A78BFA", fontSize: 10, fontWeight: "800", letterSpacing: 2 },
  heading: { color: "#F7F5FF", fontSize: 35, lineHeight: 42, fontWeight: "900", marginTop: 11 },
  headingAccent: { color: "#A78BFA" },
  intro: { color: "#AAA8B8", fontSize: 14, lineHeight: 22, marginTop: 11 },
  settingsButton: { paddingVertical: 12, marginBottom: 8 },
  smallInput: { minHeight: 46, backgroundColor: "#11111B", borderWidth: 1, borderColor: "#39394D", borderRadius: 10, padding: 11, color: "#F7F5FF", fontSize: 12, marginBottom: 8 },
  inlineInputs: { flexDirection: "row", gap: 7 },
  generatedImage: { width: "100%", aspectRatio: 16 / 9, borderRadius: 12, marginTop: 10, backgroundColor: "#11111B" },
  videoPlayer: { width: "100%", aspectRatio: 16 / 9, borderRadius: 12, marginTop: 10, backgroundColor: "#000" },
  imagePlaceholder: { width: "100%", aspectRatio: 16 / 9, borderRadius: 12, marginTop: 10, backgroundColor: "#11111B", borderWidth: 1, borderColor: "#39394D", alignItems: "center", justifyContent: "center" },
  statusPill: { alignSelf: "flex-start", marginTop: 8, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: "#173629" },
  statusReady: { color: "#7BE0A7", fontSize: 10, fontWeight: "900", letterSpacing: 0.7 },
  timelinePanel: { backgroundColor: "#202033", borderColor: "#514174", borderWidth: 1, borderRadius: 18, padding: 15, marginTop: 20 },
  progressPanel: { marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: "#151522", borderWidth: 1, borderColor: "#514174" },
  progressTitle: { color: "#D8CCFF", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  progressTrack: { height: 8, borderRadius: 8, overflow: "hidden", backgroundColor: "#39394D", marginTop: 10 },
  progressFill: { height: "100%", borderRadius: 8, backgroundColor: "#A78BFA" },
  panel: { backgroundColor: "#1A1A27", borderColor: "#303044", borderWidth: 1, borderRadius: 22, padding: 17, marginBottom: 20 },
  step: { color: "#A78BFA", fontSize: 10, fontWeight: "900", letterSpacing: 1.4 },
  panelTitle: { color: "#F7F5FF", fontSize: 22, fontWeight: "800", marginTop: 10, marginBottom: 13 },
  characterInput: { minHeight: 150, backgroundColor: "#11111B", borderWidth: 1, borderColor: "#39394D", borderRadius: 14, padding: 13, color: "#F7F5FF", fontSize: 13, lineHeight: 21 },
  sceneInput: { minHeight: 76, backgroundColor: "#11111B", borderWidth: 1, borderColor: "#39394D", borderRadius: 12, padding: 11, color: "#F7F5FF", fontSize: 12, lineHeight: 19 },
  promptInput: { minHeight: 132, backgroundColor: "#11111B", borderWidth: 1, borderColor: "#39394D", borderRadius: 12, padding: 11, color: "#F7F5FF", fontSize: 11, lineHeight: 18 },
  input: { minHeight: 120, backgroundColor: "#11111B", borderWidth: 1, borderColor: "#39394D", borderRadius: 14, padding: 13, color: "#F7F5FF", fontSize: 14, lineHeight: 21 },
  counter: { color: "#777789", fontSize: 10, textAlign: "right", marginTop: 7 },
  label: { color: "#C6C2D5", fontSize: 10, fontWeight: "800", letterSpacing: 1.2, marginTop: 21, marginBottom: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: "#414155", backgroundColor: "#20202E" },
  chipActive: { backgroundColor: "#6D4BC3", borderColor: "#A78BFA" },
  chipText: { color: "#C4C1D0", fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  primary: { marginTop: 24, borderRadius: 14, backgroundColor: "#8B5CF6", minHeight: 52, paddingHorizontal: 15, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  primaryText: { color: "#fff", fontSize: 11, fontWeight: "900", letterSpacing: 0.8 },
  arrow: { color: "#fff", fontSize: 21 },
  note: { color: "#858397", fontSize: 11, lineHeight: 17, marginTop: 13 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 5, marginBottom: 10 },
  sectionTitle: { color: "#E8E4F5", fontSize: 11, fontWeight: "900", letterSpacing: 1.3 },
  projectCount: { color: "#8E8B9E", fontSize: 10 },
  empty: { color: "#777789", fontSize: 12, paddingVertical: 18, textAlign: "center" },
  projectRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#1A1A27", borderColor: "#303044", borderWidth: 1, borderRadius: 13, padding: 13, marginBottom: 8 },
  projectOpen: { flex: 1 },
  projectName: { color: "#F2EEFF", fontSize: 13, fontWeight: "700" },
  projectMeta: { color: "#9692A8", fontSize: 10, marginTop: 5 },
  deleteButton: { padding: 8 },
  deleteAllButton: { alignSelf: "flex-end", paddingVertical: 9, paddingHorizontal: 10, marginBottom: 8, borderWidth: 1, borderColor: "#713B49", borderRadius: 9 },
  deleteText: { color: "#FCA5A5", fontSize: 10, fontWeight: "700" },
  backButton: { paddingVertical: 8, marginBottom: 12 },
  backText: { color: "#C4B5FD", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  body: { color: "#B8B6C5", fontSize: 13, lineHeight: 21 },
  scene: { borderTopWidth: 1, borderTopColor: "#343447", marginTop: 18, paddingTop: 15 },
  sceneTitle: { color: "#D8CCFF", fontSize: 15, fontWeight: "800", marginBottom: 8 },
  dialogue: { color: "#A78BFA", fontSize: 13, fontStyle: "italic", marginTop: 9 },
  secondary: { borderWidth: 1, borderColor: "#8B5CF6", borderRadius: 12, padding: 14, alignItems: "center", marginTop: 10 },
  secondaryText: { color: "#C4B5FD", fontWeight: "800", fontSize: 10, letterSpacing: 0.8 },
  footer: { color: "#696779", fontSize: 9, textAlign: "center", letterSpacing: 1.2, marginTop: 22 }
});