import React, { useEffect, useMemo, useState } from "react";
import {
  Alert, Linking, SafeAreaView, ScrollView, Share, StatusBar, StyleSheet,
  Text, TextInput, TouchableOpacity, View, Image
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import { useVideoPlayer, VideoView } from "expo-video";
import { createStoryPlan, type Genre } from "./src/engine/storyEngine";
import { ComfyUiImageProvider, type ComfyUiImageWorkflow } from "./src/engine/providers/comfyuiImageProvider";
import { ComfyUiVideoProvider, type ComfyUiVideoWorkflow } from "./src/engine/providers/comfyuiVideoProvider";

type Scene = { title: string; description: string; dialogue: string; imagePrompt: string; videoPrompt: string; shot: string; camera: string; lighting: string; imageUri?: string; videoUri?: string; videoRemoteUri?: string };
type Project = {
  id: string;
  title: string;
  idea: string;
  genre: string;
  duration: string;
  character: string;
  scenes: Scene[];
  createdAt: string;
};

const STORAGE_KEY = "@estudio2d/projects-v1";
const COMFY_STORAGE_KEY = "@estudio2d/comfyui-v1";
type ComfyConfig = {
  baseUrl: string; workflowText: string; positiveNode: string; negativeNode: string;
  widthNode: string; heightNode: string; seedNode: string;
  videoWorkflowText?: string; videoImageNode?: string; videoPositiveNode?: string;
  videoNegativeNode?: string; videoWidthNode?: string; videoHeightNode?: string;
  videoFramesNode?: string; videoFpsNode?: string; videoSeedNode?: string;
};
const genres = ["Aventura", "Comédia", "Fantasia", "Ação", "Drama", "Mistério"];
const durations = ["30 segundos", "1 minuto", "2 minutos", "3 minutos", "5 minutos", "10 minutos"];

function buildProject(idea: string, genre: string, duration: string): Project {
  const character = "Personagem principal\nNome: a definir\nAparência: a definir\nRoupa: a definir\nPersonalidade: a definir\nVoz: a definir\nRegra de continuidade: manter o mesmo rosto, cabelo, roupa, cores e proporções em todas as cenas.";
  const plan = createStoryPlan(idea, genre as Genre, duration, character);
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
    createdAt: new Date().toISOString()
  };
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
    ...project.scenes.flatMap(scene => [scene.title, scene.description, scene.dialogue, "ENQUADRAMENTO: " + (scene.shot || "plano médio"), "CÂMERA: " + (scene.camera || "movimento suave"), "ILUMINAÇÃO: " + (scene.lighting || "luz cinematográfica"), "PROMPT DE IMAGEM: " + (scene.imagePrompt || ""), "PROMPT DE ANIMAÇÃO: " + (scene.videoPrompt || ""), ""])
  ].join("\n");
}

function SceneVideoPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, instance => {
    instance.loop = true;
  });
  return <VideoView player={player} style={styles.videoPlayer} nativeControls contentFit="contain" />;
}

export default function App() {
  const [idea, setIdea] = useState("");
  const [genre, setGenre] = useState("Aventura");
  const [duration, setDuration] = useState("1 minuto");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [ready, setReady] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [comfyConfig, setComfyConfig] = useState<ComfyConfig>({ baseUrl: "", workflowText: "", positiveNode: "", negativeNode: "", widthNode: "", heightNode: "", seedNode: "", videoWorkflowText: "", videoImageNode: "", videoPositiveNode: "", videoNegativeNode: "", videoWidthNode: "", videoHeightNode: "", videoFramesNode: "", videoFpsNode: "", videoSeedNode: "" });
  const [connectionStatus, setConnectionStatus] = useState("Não testada");
  const [busyScene, setBusyScene] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(COMFY_STORAGE_KEY)
      .then(value => {
        if (value) setComfyConfig(prev => ({ ...prev, ...(JSON.parse(value) as Partial<ComfyConfig>) }));
      })
      .catch(() => Alert.alert("Aviso", "Não foi possível carregar a configuração do ComfyUI."));
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

  const saveComfyConfig = async () => {
    try { await AsyncStorage.setItem(COMFY_STORAGE_KEY, JSON.stringify(comfyConfig)); Alert.alert("Configuração salva", "As configurações do servidor foram guardadas neste aparelho."); }
    catch { Alert.alert("Erro", "Não foi possível salvar a configuração."); }
  };

  const testComfyConnection = async () => {
    const url = comfyConfig.baseUrl.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(url)) { Alert.alert("Endereço inválido", "Informe o endereço completo do ComfyUI."); return; }
    setConnectionStatus("Testando…");
    try { const response = await fetch(`${url}/system_stats`); if (!response.ok) throw new Error(`HTTP ${response.status}`); await response.json(); setConnectionStatus("Conectado"); Alert.alert("Conexão confirmada", "O aplicativo conseguiu acessar o servidor ComfyUI."); }
    catch (error) { setConnectionStatus("Falha na conexão"); Alert.alert("Não conectou", error instanceof Error ? error.message : "Verifique endereço, rede e HTTPS."); }
  };

  const generateSceneImage = async (scene: Scene) => {
    if (!selected) return;
    if (!comfyConfig.baseUrl.trim() || !comfyConfig.workflowText.trim() || !comfyConfig.positiveNode.trim()) { Alert.alert("Configure o ComfyUI", "Abra Configurar geração e informe servidor, workflow API e nó do prompt positivo."); setShowSettings(true); return; }
    setBusyScene(scene.title);
    try {
      const workflow = JSON.parse(comfyConfig.workflowText) as ComfyUiImageWorkflow;
      const provider = new ComfyUiImageProvider({ baseUrl: comfyConfig.baseUrl, workflow, positivePromptNodeId: comfyConfig.positiveNode.trim(), negativePromptNodeId: comfyConfig.negativeNode.trim() || undefined, widthNodeId: comfyConfig.widthNode.trim() || undefined, heightNodeId: comfyConfig.heightNode.trim() || undefined, seedNodeId: comfyConfig.seedNode.trim() || undefined });
      const result = await provider.generate({ prompt: scene.imagePrompt, width: 1024, height: 576 });
      if (result.status !== "completed" || !result.outputUri) throw new Error(result.error || "A geração não retornou uma imagem.");
      const updated = { ...selected, scenes: selected.scenes.map(item => item.title === scene.title ? { ...item, imageUri: result.outputUri } : item) };
      saveUpdatedProject(updated);
      Alert.alert("Imagem gerada", "A imagem desta cena foi salva no projeto.");
    } catch (error) { Alert.alert("Erro na geração", error instanceof Error ? error.message : "Não foi possível gerar a imagem."); }
    finally { setBusyScene(null); }
  };

  const generateSceneVideo = async (scene: Scene) => {
    if (!selected) return;
    if (!scene.imageUri) {
      Alert.alert("Imagem necessária", "Gere primeiro a imagem desta cena para usá-la como referência do vídeo.");
      return;
    }
    if (!comfyConfig.baseUrl.trim() || !comfyConfig.videoWorkflowText?.trim() || !comfyConfig.videoImageNode?.trim() || !comfyConfig.videoPositiveNode?.trim()) {
      Alert.alert("Configure o motor de vídeo", "Abra Configurar geração e informe o workflow de vídeo, o nó LoadImage e o nó do prompt positivo.");
      setShowSettings(true);
      return;
    }
    setBusyScene(`video:${scene.title}`);
    try {
      const workflow = JSON.parse(comfyConfig.videoWorkflowText) as ComfyUiVideoWorkflow;
      const provider = new ComfyUiVideoProvider({
        baseUrl: comfyConfig.baseUrl,
        workflow,
        imageNodeId: comfyConfig.videoImageNode.trim(),
        positivePromptNodeId: comfyConfig.videoPositiveNode.trim(),
        negativePromptNodeId: comfyConfig.videoNegativeNode?.trim() || undefined,
        widthNodeId: comfyConfig.videoWidthNode?.trim() || undefined,
        heightNodeId: comfyConfig.videoHeightNode?.trim() || undefined,
        framesNodeId: comfyConfig.videoFramesNode?.trim() || undefined,
        fpsNodeId: comfyConfig.videoFpsNode?.trim() || undefined,
        seedNodeId: comfyConfig.videoSeedNode?.trim() || undefined,
      });
      const result = await provider.generate({
        prompt: scene.videoPrompt || scene.description,
        imageUri: scene.imageUri,
        durationSeconds: 4,
        width: 1024,
        height: 576,
        fps: 16,
      });
      if (result.status !== "completed" || !result.outputUri) throw new Error(result.error || "O workflow não retornou um vídeo.");
      const updated = { ...selected, scenes: selected.scenes.map(item => item.title === scene.title ? { ...item, videoUri: result.outputUri } : item) };
      saveUpdatedProject(updated);
      Alert.alert("Clipe concluído", "O vídeo desta cena foi salvo no projeto.");
    } catch (error) {
      Alert.alert("Erro na geração do vídeo", error instanceof Error ? error.message : "Não foi possível gerar o clipe.");
    } finally {
      setBusyScene(null);
    }
  };

  const generateAllSceneImages = async () => {
    if (!selected) return;
    if (!comfyConfig.baseUrl.trim() || !comfyConfig.workflowText.trim() || !comfyConfig.positiveNode.trim()) {
      Alert.alert("Configure o motor de imagens", "Informe o workflow API e o nó do prompt positivo.");
      setShowSettings(true);
      return;
    }
    const pendingScenes = selected.scenes.filter(scene => !scene.imageUri);
    if (!pendingScenes.length) {
      Alert.alert("Imagens prontas", "Todas as cenas já possuem imagem. Você pode seguir para a animação.");
      return;
    }
    let workingProject = selected;
    let completed = 0;
    setBatchProgress({ current: 0, total: pendingScenes.length });
    try {
      const workflow = JSON.parse(comfyConfig.workflowText) as ComfyUiImageWorkflow;
      const provider = new ComfyUiImageProvider({
        baseUrl: comfyConfig.baseUrl,
        workflow,
        positivePromptNodeId: comfyConfig.positiveNode.trim(),
        negativePromptNodeId: comfyConfig.negativeNode.trim() || undefined,
        widthNodeId: comfyConfig.widthNode.trim() || undefined,
        heightNodeId: comfyConfig.heightNode.trim() || undefined,
        seedNodeId: comfyConfig.seedNode.trim() || undefined,
      });
      for (const scene of pendingScenes) {
        setBusyScene(scene.title);
        const result = await provider.generate({ prompt: scene.imagePrompt, width: 1024, height: 576 });
        if (result.status !== "completed" || !result.outputUri) {
          throw new Error(`${scene.title}: ${result.error || "o workflow não retornou uma imagem"}`);
        }
        workingProject = {
          ...workingProject,
          scenes: workingProject.scenes.map(item => item.title === scene.title
            ? { ...item, imageUri: result.outputUri, videoUri: undefined, videoRemoteUri: undefined }
            : item),
        };
        completed += 1;
        setSelected(workingProject);
        setProjects(previous => previous.map(item => item.id === workingProject.id ? workingProject : item));
        setBatchProgress({ current: completed, total: pendingScenes.length });
      }
      Alert.alert("Imagens concluídas", `${completed} imagens foram geradas e salvas no projeto.`);
    } catch (error) {
      Alert.alert("Geração interrompida", `${completed} de ${pendingScenes.length} imagens concluídas. ${error instanceof Error ? error.message : "Falha desconhecida."}`);
    } finally {
      setBusyScene(null);
      setBatchProgress(null);
    }
  };

  const generateAllSceneVideos = async () => {
    if (!selected) return;
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
    if (!comfyConfig.baseUrl.trim() || !comfyConfig.videoWorkflowText?.trim() || !comfyConfig.videoImageNode?.trim() || !comfyConfig.videoPositiveNode?.trim()) {
      Alert.alert("Configure o motor de vídeo", "Informe o workflow de vídeo e os nós LoadImage e prompt positivo.");
      setShowSettings(true);
      return;
    }
    let workingProject = selected;
    let completed = 0;
    setBatchProgress({ current: 0, total: pendingScenes.length });
    try {
      const workflow = JSON.parse(comfyConfig.videoWorkflowText) as ComfyUiVideoWorkflow;
      const provider = new ComfyUiVideoProvider({
        baseUrl: comfyConfig.baseUrl,
        workflow,
        imageNodeId: comfyConfig.videoImageNode.trim(),
        positivePromptNodeId: comfyConfig.videoPositiveNode.trim(),
        negativePromptNodeId: comfyConfig.videoNegativeNode?.trim() || undefined,
        widthNodeId: comfyConfig.videoWidthNode?.trim() || undefined,
        heightNodeId: comfyConfig.videoHeightNode?.trim() || undefined,
        framesNodeId: comfyConfig.videoFramesNode?.trim() || undefined,
        fpsNodeId: comfyConfig.videoFpsNode?.trim() || undefined,
        seedNodeId: comfyConfig.videoSeedNode?.trim() || undefined,
      });
      for (const scene of pendingScenes) {
        setBusyScene(`video:${scene.title}`);
        const result = await provider.generate({
          prompt: scene.videoPrompt || scene.description,
          imageUri: scene.imageUri,
          durationSeconds: 4,
          width: 1024,
          height: 576,
          fps: 16,
        });
        if (result.status !== "completed" || !result.outputUri) {
          throw new Error(`${scene.title}: ${result.error || "o workflow não retornou um clipe"}`);
        }
        workingProject = {
          ...workingProject,
          scenes: workingProject.scenes.map(item => item.title === scene.title
            ? { ...item, videoUri: result.outputUri, videoRemoteUri: undefined }
            : item),
        };
        completed += 1;
        setSelected(workingProject);
        setProjects(previous => previous.map(item => item.id === workingProject.id ? workingProject : item));
        setBatchProgress({ current: completed, total: pendingScenes.length });
      }
      Alert.alert("Animação concluída", `${completed} novos clipes foram gerados. ${selected.scenes.length - pendingScenes.length} cenas já tinham vídeo.`);
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

  const openSceneVideo = async (uri: string) => {
    try { await Linking.openURL(uri); }
    catch { Alert.alert("Não foi possível abrir", "Verifique se o endereço do vídeo está acessível no celular."); }
  };

  const currentScript = useMemo(() => selected ? projectText(selected) : "", [selected]);

  const createProject = () => {
    const cleanIdea = idea.trim();
    if (!cleanIdea) {
      Alert.alert("Falta sua ideia", "Escreva uma ideia para começar.");
      return;
    }
    const project = buildProject(cleanIdea, genre, duration);
    setProjects(previous => [project, ...previous]);
    setSelected(project);
    setIdea("");
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

  const deleteProject = (id: string) => {
    Alert.alert("Excluir projeto?", "Essa ação remove o projeto salvo neste aparelho.", [
      { text: "Cancelar", style: "cancel" },
      { text: "Excluir", style: "destructive", onPress: () => {
        setProjects(previous => previous.filter(item => item.id !== id));
        if (selected?.id === id) setSelected(null);
      }}
    ]);
  };

  const startNew = () => {
    setSelected(null);
    setIdea("");
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
      scenes: selected.scenes.map(scene => ({
        ...scene,
        imagePrompt: updateCharacterInPrompt(scene.imagePrompt || "", selected.character, value),
        videoPrompt: updateCharacterInPrompt(scene.videoPrompt || "", selected.character, value)
      }))
    };
    saveUpdatedProject(updated);
  };

  const updateScene = (sceneTitle: string, field: "description" | "dialogue" | "imagePrompt" | "videoPrompt", value: string) => {
    if (!selected) return;
    saveUpdatedProject({
      ...selected,
      scenes: selected.scenes.map(scene => scene.title === sceneTitle ? { ...scene, [field]: value } : scene)
    });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#101018" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={styles.logo}><Text style={styles.logoText}>✦</Text></View>
          <View style={styles.brandWrap}>
            <Text style={styles.brand}>ESTÚDIO <Text style={styles.brandAccent}>2D</Text></Text>
            <Text style={styles.subtitle}>SEU UNIVERSO DE ANIMAÇÃO</Text>
          </View>
          <View style={styles.privatePill}><Text style={styles.privateText}>PESSOAL</Text></View>
        </View>

        <TouchableOpacity style={styles.settingsButton} onPress={() => setShowSettings(value => !value)}><Text style={styles.backText}>{showSettings ? "FECHAR CONFIGURAÇÕES" : "⚙  CONFIGURAR MOTORES DE GERAÇÃO"}</Text></TouchableOpacity>\n        {showSettings && <View style={styles.panel}>\n          <Text style={styles.step}>MOTOR DE IMAGENS · SERVIDOR PRÓPRIO</Text>\n          <Text style={styles.panelTitle}>Conectar ComfyUI</Text>\n          <Text style={styles.note}>Este modo usa um servidor ComfyUI que você controla. O aplicativo não cobra créditos, mas precisa de um computador/servidor com modelo de imagem instalado e acessível pela rede.</Text>\n          <Text style={styles.label}>ENDEREÇO DO SERVIDOR</Text>\n          <TextInput value={comfyConfig.baseUrl} onChangeText={value => setComfyConfig(prev => ({ ...prev, baseUrl: value }))} autoCapitalize="none" placeholder="https://seu-servidor:8188" placeholderTextColor="#777789" style={styles.input} />\n          <Text style={styles.label}>WORKFLOW API JSON DE IMAGEM</Text>\n          <TextInput value={comfyConfig.workflowText} onChangeText={value => setComfyConfig(prev => ({ ...prev, workflowText: value }))} multiline textAlignVertical="top" placeholder="Cole aqui o JSON exportado em formato API pelo ComfyUI" placeholderTextColor="#777789" style={styles.workflowInput} />\n          <Text style={styles.label}>ID DO NÓ DE PROMPT POSITIVO (CLIPTextEncode)</Text>\n          <TextInput value={comfyConfig.positiveNode} onChangeText={value => setComfyConfig(prev => ({ ...prev, positiveNode: value }))} keyboardType="number-pad" placeholder="Ex.: 6" placeholderTextColor="#777789" style={styles.smallInput} />\n          <Text style={styles.label}>ID DO NÓ DE PROMPT NEGATIVO (OPCIONAL)</Text>\n          <TextInput value={comfyConfig.negativeNode} onChangeText={value => setComfyConfig(prev => ({ ...prev, negativeNode: value }))} keyboardType="number-pad" placeholder="Ex.: 7" placeholderTextColor="#777789" style={styles.smallInput} />\n          <Text style={styles.label}>ID DOS NÓS DE LARGURA / ALTURA / SEED (OPCIONAIS)</Text>\n          <View style={styles.inlineInputs}>{(["widthNode", "heightNode", "seedNode"] as const).map((key, index) => <TextInput key={key} value={comfyConfig[key]} onChangeText={value => setComfyConfig(prev => ({ ...prev, [key]: value }))} keyboardType="number-pad" placeholder={["Largura", "Altura", "Seed"][index]} placeholderTextColor="#777789" style={[styles.smallInput, { flex: 1 }]} />)}</View>\n          <Text style={styles.label}>WORKFLOW API DE VÍDEO (IMAGEM-PARA-VÍDEO)</Text>
          <TextInput value={comfyConfig.videoWorkflowText || ""} onChangeText={value => setComfyConfig(prev => ({ ...prev, videoWorkflowText: value }))} multiline textAlignVertical="top" placeholder="Cole o workflow API de vídeo com LoadImage e SaveVideo" placeholderTextColor="#777789" style={styles.workflowInput} />
          <Text style={styles.label}>NÓS DO WORKFLOW DE VÍDEO</Text>
          <View style={styles.inlineInputs}>
            {(["videoImageNode", "videoPositiveNode", "videoNegativeNode"] as const).map((key, index) => <TextInput key={key} value={comfyConfig[key] || ""} onChangeText={value => setComfyConfig(prev => ({ ...prev, [key]: value }))} keyboardType="number-pad" placeholder={["LoadImage", "Prompt+", "Prompt-"][index]} placeholderTextColor="#777789" style={[styles.smallInput, { flex: 1 }]} />)}
          </View>
          <Text style={styles.label}>NÓS OPCIONAIS: LARGURA / ALTURA / QUADROS / FPS / SEED</Text>
          <View style={styles.inlineInputs}>
            {(["videoWidthNode", "videoHeightNode", "videoFramesNode", "videoFpsNode", "videoSeedNode"] as const).map((key, index) => <TextInput key={key} value={comfyConfig[key] || ""} onChangeText={value => setComfyConfig(prev => ({ ...prev, [key]: value }))} keyboardType="number-pad" placeholder={["Larg.", "Alt.", "Frames", "FPS", "Seed"][index]} placeholderTextColor="#777789" style={[styles.smallInput, { flex: 1 }]} />)}
          </View>
          <Text style={styles.note}>O workflow de imagem termina em SaveImage. O de vídeo precisa ter LoadImage conectado ao modelo de animação e SaveVideo na saída. Os nomes de entrada padrão do adaptador são image, text, width, height, length, fps e seed. Cada clique gera um clipe de referência de 4 segundos a 16 FPS.</Text>\n          <TouchableOpacity style={styles.secondary} onPress={saveComfyConfig}><Text style={styles.secondaryText}>SALVAR CONFIGURAÇÃO</Text></TouchableOpacity>\n          <TouchableOpacity style={styles.primary} onPress={testComfyConnection}><Text style={styles.primaryText}>TESTAR CONEXÃO</Text><Text style={styles.arrow}>→</Text></TouchableOpacity>\n        </View>}\n\n        <View style={styles.hero}>
          <Text style={styles.eyebrow}>IDEIAS QUE GANHAM VIDA</Text>
          <Text style={styles.heading}>Crie sua próxima{"\n"}<Text style={styles.headingAccent}>animação.</Text></Text>
          <Text style={styles.intro}>Seu espaço para desenvolver histórias, personagens e cenas.</Text>
        </View>

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

            <TouchableOpacity style={styles.primary} onPress={createProject}>
              <Text style={styles.primaryText}>✦  CRIAR MEU PROJETO</Text><Text style={styles.arrow}>→</Text>
            </TouchableOpacity>
            <Text style={styles.note}>O app organiza a história em cenas. Com um ComfyUI próprio, você pode gerar imagens e animar cada cena com um workflow de vídeo compatível. Voz e montagem final ainda serão etapas futuras.</Text>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>MEUS PROJETOS</Text>
            <Text style={styles.projectCount}>{projects.length} salvo(s)</Text>
          </View>
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
          <TouchableOpacity onPress={startNew} style={styles.backButton}><Text style={styles.backText}>‹  VOLTAR AOS PROJETOS</Text></TouchableOpacity>
          <View style={styles.panel}>
            <Text style={styles.step}>PROJETO SALVO NO APARELHO</Text>
            <Text style={styles.panelTitle}>{selected.title}</Text>
            <Text style={styles.projectMeta}>{selected.genre} · {selected.duration} · {selected.scenes.length} cenas</Text>
            <Text style={styles.label}>IDEIA ORIGINAL</Text>
            <Text style={styles.body}>{selected.idea}</Text>
            <Text style={styles.label}>FICHA DO PERSONAGEM</Text>
            <TextInput value={selected.character} onChangeText={updateCharacter} multiline textAlignVertical="top" placeholder="Descreva aparência, roupa, personalidade e voz do personagem..." placeholderTextColor="#777789" style={styles.characterInput} />
            {selected.scenes.map(scene => <View key={scene.title} style={styles.scene}>
              <Text style={styles.sceneTitle}>{scene.title}</Text>
              {scene.imageUri ? <Image source={{ uri: scene.imageUri }} style={styles.generatedImage} resizeMode="cover" /> : <View style={styles.imagePlaceholder}><Text style={styles.note}>Imagem ainda não gerada</Text></View>}\n              <TouchableOpacity style={styles.secondary} disabled={busyScene === scene.title || busyScene === `video:${scene.title}`} onPress={() => generateSceneImage(scene)}><Text style={styles.secondaryText}>{busyScene === scene.title ? "GERANDO IMAGEM…" : "GERAR IMAGEM DESTA CENA"}</Text></TouchableOpacity>
              <TouchableOpacity style={styles.primary} disabled={busyScene === scene.title || busyScene === `video:${scene.title}`} onPress={() => generateSceneVideo(scene)}><Text style={styles.primaryText}>{busyScene === `video:${scene.title}` ? "GERANDO CLIPE…" : "ANIMAR ESTA CENA · 4 SEGUNDOS"}</Text><Text style={styles.arrow}>▶</Text></TouchableOpacity>
              {scene.videoUri ? <><SceneVideoPlayer uri={scene.videoUri} /><TouchableOpacity style={styles.secondary} disabled={busyScene === `download:${scene.title}`} onPress={() => downloadSceneVideo(scene)}><Text style={styles.secondaryText}>{busyScene === `download:${scene.title}` ? "SALVANDO NO IPHONE…" : scene.videoUri.startsWith("file://") ? "VÍDEO SALVO OFFLINE" : "BAIXAR VÍDEO PARA O IPHONE"}</Text></TouchableOpacity><TouchableOpacity style={styles.secondary} onPress={() => openSceneVideo(scene.videoRemoteUri || scene.videoUri!)}><Text style={styles.secondaryText}>ABRIR VÍDEO NO NAVEGADOR</Text></TouchableOpacity></> : null}
              <Text style={styles.label}>AÇÃO DA CENA</Text>
              <TextInput value={scene.description} onChangeText={value => updateScene(scene.title, "description", value)} multiline textAlignVertical="top" placeholder="Descreva o que acontece nesta cena..." placeholderTextColor="#777789" style={styles.sceneInput} />
              <Text style={styles.label}>FALA / DIÁLOGO</Text>
              <TextInput value={scene.dialogue} onChangeText={value => updateScene(scene.title, "dialogue", value)} multiline textAlignVertical="top" placeholder="Escreva a fala do personagem..." placeholderTextColor="#777789" style={styles.sceneInput} />
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
              <Text style={styles.body}>{selected.scenes.filter(scene => !!scene.videoUri).length} de {selected.scenes.length} clipes gerados · {selected.scenes.filter(scene => !!scene.imageUri).length} imagens prontas</Text>
              <TouchableOpacity style={styles.secondary} disabled={!!busyScene || !!batchProgress} onPress={generateAllSceneImages}>
                <Text style={styles.secondaryText}>{batchProgress ? "PROCESSANDO IMAGENS…" : "GERAR IMAGENS PENDENTES"}</Text>
              </TouchableOpacity>
              {batchProgress ? <Text style={styles.note}>Concluídas {batchProgress.current} de {batchProgress.total}…</Text> : null}
              <TouchableOpacity style={styles.primary} disabled={!!busyScene || !!batchProgress} onPress={generateAllSceneVideos}>
                <Text style={styles.primaryText}>{batchProgress ? "PROCESSANDO VÍDEOS…" : "ANIMAR CENAS PENDENTES"}</Text><Text style={styles.arrow}>▶</Text>
              </TouchableOpacity>
              <Text style={styles.note}>Gera os clipes em sequência usando as imagens já criadas. A montagem em um único MP4 com transições e áudio ainda será uma etapa separada.</Text>
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
  workflowInput: { minHeight: 180, backgroundColor: "#11111B", borderWidth: 1, borderColor: "#39394D", borderRadius: 12, padding: 11, color: "#F7F5FF", fontSize: 10, lineHeight: 16 },
  smallInput: { minHeight: 46, backgroundColor: "#11111B", borderWidth: 1, borderColor: "#39394D", borderRadius: 10, padding: 11, color: "#F7F5FF", fontSize: 12, marginBottom: 8 },
  inlineInputs: { flexDirection: "row", gap: 7 },
  generatedImage: { width: "100%", aspectRatio: 16 / 9, borderRadius: 12, marginTop: 10, backgroundColor: "#11111B" },
  videoPlayer: { width: "100%", aspectRatio: 16 / 9, borderRadius: 12, marginTop: 10, backgroundColor: "#000" },
  imagePlaceholder: { width: "100%", aspectRatio: 16 / 9, borderRadius: 12, marginTop: 10, backgroundColor: "#11111B", borderWidth: 1, borderColor: "#39394D", alignItems: "center", justifyContent: "center" },
  timelinePanel: { backgroundColor: "#202033", borderColor: "#514174", borderWidth: 1, borderRadius: 18, padding: 15, marginTop: 20 },
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