import React, { useEffect, useMemo, useState } from "react";
import {
  Alert, SafeAreaView, ScrollView, Share, StatusBar, StyleSheet,
  Text, TextInput, TouchableOpacity, View
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import { createStoryPlan, type Genre } from "./src/engine/storyEngine";

type Scene = { title: string; description: string; dialogue: string; imagePrompt: string; videoPrompt: string; shot: string; camera: string; lighting: string };
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
const genres = ["Aventura", "Comédia", "Fantasia", "Ação", "Drama", "Mistério"];
const durations = ["30 segundos", "1 minuto", "2 minutos", "3 minutos", "5 minutos", "10 minutos"];

function buildProject(idea: string, genre: string, duration: string): Project {
  const character = "Personagem principal\\nNome: a definir\\nAparência: a definir\\nRoupa: a definir\\nPersonalidade: a definir\\nVoz: a definir\\nRegra de continuidade: manter o mesmo rosto, cabelo, roupa, cores e proporções em todas as cenas.";
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

export default function App() {
  const [idea, setIdea] = useState("");
  const [genre, setGenre] = useState("Aventura");
  const [duration, setDuration] = useState("1 minuto");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [ready, setReady] = useState(false);

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
    const plan = createStoryPlan(selected.idea, selected.genre as Genre, selected.duration, value);
    const updated: Project = {
      ...selected,
      character: value,
      scenes: selected.scenes.map((scene, index) => {
        const planned = plan.scenes[index];
        return planned ? { ...scene, imagePrompt: planned.imagePrompt, videoPrompt: planned.videoPrompt } : scene;
      })
    };
    saveUpdatedProject(updated);
  };

  const updateScene = (sceneTitle: string, field: "description" | "dialogue", value: string) => {
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

        <View style={styles.hero}>
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
            <Text style={styles.note}>O app distribui a história em cenas conforme a duração escolhida. A geração real de imagens, vozes e vídeos será integrada em uma próxima etapa.</Text>
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
              <Text style={styles.label}>AÇÃO DA CENA</Text>
              <TextInput value={scene.description} onChangeText={value => updateScene(scene.title, "description", value)} multiline textAlignVertical="top" placeholder="Descreva o que acontece nesta cena..." placeholderTextColor="#777789" style={styles.sceneInput} />
              <Text style={styles.label}>FALA / DIÁLOGO</Text>
              <TextInput value={scene.dialogue} onChangeText={value => updateScene(scene.title, "dialogue", value)} multiline textAlignVertical="top" placeholder="Escreva a fala do personagem..." placeholderTextColor="#777789" style={styles.sceneInput} />
              <Text style={styles.label}>ENQUADRAMENTO · {(scene.shot || "plano médio").toUpperCase()}</Text>
              <Text style={styles.body}>Câmera: {scene.camera}{"\n"}Luz: {scene.lighting}</Text>
              <Text style={styles.label}>PROMPT VISUAL</Text>
              <Text style={styles.body}>{scene.imagePrompt || "Prompt visual ainda não disponível para este projeto antigo."}</Text>
              <Text style={styles.label}>PROMPT DE ANIMAÇÃO</Text>
              <Text style={styles.body}>{scene.videoPrompt || "Prompt de animação ainda não disponível para este projeto antigo."}</Text>
            </View>)}
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
  panel: { backgroundColor: "#1A1A27", borderColor: "#303044", borderWidth: 1, borderRadius: 22, padding: 17, marginBottom: 20 },
  step: { color: "#A78BFA", fontSize: 10, fontWeight: "900", letterSpacing: 1.4 },
  panelTitle: { color: "#F7F5FF", fontSize: 22, fontWeight: "800", marginTop: 10, marginBottom: 13 },
  characterInput: { minHeight: 150, backgroundColor: "#11111B", borderWidth: 1, borderColor: "#39394D", borderRadius: 14, padding: 13, color: "#F7F5FF", fontSize: 13, lineHeight: 21 },
  sceneInput: { minHeight: 76, backgroundColor: "#11111B", borderWidth: 1, borderColor: "#39394D", borderRadius: 12, padding: 11, color: "#F7F5FF", fontSize: 12, lineHeight: 19 },
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