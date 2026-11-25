import React, { useMemo, useState } from "react";
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";

type Scene = { title: string; description: string; dialogue: string };

export default function App() {
  const [idea, setIdea] = useState("");
  const [genre, setGenre] = useState("Aventura");
  const [duration, setDuration] = useState("1 minuto");
  const [project, setProject] = useState<{ title: string; character: string; scenes: Scene[] } | null>(null);

  const genres = ["Aventura", "Comédia", "Fantasia", "Ação", "Drama", "Mistério"];
  const durations = ["30 segundos", "1 minuto", "2 minutos", "3 minutos"];

  const createProject = () => {
    if (!idea.trim()) {
      Alert.alert("Falta sua ideia", "Escreva uma ideia para começar a animação.");
      return;
    }
    const cleanIdea = idea.trim();
    setProject({
      title: cleanIdea.length > 42 ? cleanIdea.slice(0, 42).trim() + "…" : cleanIdea,
      character: "Personagem principal\nA definir: nome, idade, aparência, roupa, personalidade e voz. Essa ficha será usada para manter a consistência visual nas cenas.",
      scenes: [
        { title: "Cena 1 — Apresentação", description: "Apresente o personagem e o mundo da história. Ideia-base: " + cleanIdea, dialogue: "Personagem: Tudo começou quando…" },
        { title: "Cena 2 — Desenvolvimento", description: "Mostre o desafio principal da história no estilo " + genre.toLowerCase() + ".", dialogue: "Personagem: Eu preciso descobrir o que está acontecendo!" },
        { title: "Cena 3 — Desfecho", description: "Crie uma conclusão coerente e deixe espaço para uma continuação, se fizer sentido.", dialogue: "Narrador: E assim, uma nova aventura começou." }
      ]
    });
  };

  const script = useMemo(() => {
    if (!project) return "";
    return [project.title, "Gênero: " + genre, "Duração: " + duration, "", project.character, "", ...project.scenes.flatMap(s => [s.title, s.description, s.dialogue, ""])].join("\n");
  }, [project, genre, duration]);

  const copyNotice = () => Alert.alert("Roteiro pronto", "A criação de roteiro está funcionando nesta primeira versão do aplicativo. A cópia e exportação serão adicionadas na próxima etapa.");

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#101018" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={styles.logo}><Text style={styles.logoText}>✦</Text></View>
          <View><Text style={styles.brand}>ESTÚDIO <Text style={styles.brandAccent}>2D</Text></Text><Text style={styles.subtitle}>SEU UNIVERSO DE ANIMAÇÃO</Text></View>
        </View>

        <View style={styles.hero}>
          <Text style={styles.eyebrow}>IDEIAS QUE GANHAM VIDA</Text>
          <Text style={styles.heading}>Crie sua próxima{"\n"}<Text style={styles.headingAccent}>animação.</Text></Text>
          <Text style={styles.intro}>Transforme uma ideia em personagens, cenas e histórias animadas.</Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.step}>01 / NOVO PROJETO</Text>
          <Text style={styles.panelTitle}>Qual é a sua ideia?</Text>
          <TextInput
            value={idea}
            onChangeText={setIdea}
            multiline
            maxLength={700}
            placeholder="Ex.: Um garoto encontra um portal secreto e conhece um pequeno dragão..."
            placeholderTextColor="#777789"
            style={styles.input}
            textAlignVertical="top"
          />
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
            <Text style={styles.primaryText}>✦  CRIAR MEU PROJETO</Text>
            <Text style={styles.arrow}>→</Text>
          </TouchableOpacity>
          <Text style={styles.note}>Esta versão inicial cria a estrutura do roteiro no aplicativo. A geração real de imagens, vozes e vídeos será integrada depois.</Text>
        </View>

        {project && <View style={styles.panel}>
          <Text style={styles.step}>02 / SEU PROJETO</Text>
          <Text style={styles.panelTitle}>{project.title}</Text>
          <Text style={styles.label}>FICHA DO PERSONAGEM</Text>
          <Text style={styles.body}>{project.character}</Text>
          {project.scenes.map((scene, index) => <View key={scene.title} style={styles.scene}>
            <Text style={styles.sceneTitle}>{scene.title}</Text>
            <Text style={styles.body}>{scene.description}</Text>
            <Text style={styles.dialogue}>{scene.dialogue}</Text>
          </View>)}
          <TouchableOpacity style={styles.secondary} onPress={copyNotice}><Text style={styles.secondaryText}>ROTEIRO GERADO ✓</Text></TouchableOpacity>
        </View>}

        <Text style={styles.footer}>ESTÚDIO 2D  ·  VERSÃO INICIAL DO APLICATIVO</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#101018" },
  container: { padding: 22, paddingBottom: 48 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12 },
  logo: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#8B5CF6", alignItems: "center", justifyContent: "center" },
  logoText: { color: "#fff", fontSize: 25 },
  brand: { color: "#F5F3FF", fontSize: 15, fontWeight: "900", letterSpacing: 2 },
  brandAccent: { color: "#A78BFA" },
  subtitle: { color: "#88869A", fontSize: 9, letterSpacing: 1.5, marginTop: 3 },
  hero: { marginTop: 42, marginBottom: 26 },
  eyebrow: { color: "#A78BFA", fontSize: 10, fontWeight: "800", letterSpacing: 2 },
  heading: { color: "#F7F5FF", fontSize: 36, lineHeight: 42, fontWeight: "900", marginTop: 12 },
  headingAccent: { color: "#A78BFA" },
  intro: { color: "#AAA8B8", fontSize: 14, lineHeight: 22, marginTop: 12, maxWidth: 310 },
  panel: { backgroundColor: "#1A1A27", borderColor: "#303044", borderWidth: 1, borderRadius: 22, padding: 18, marginBottom: 18 },
  step: { color: "#A78BFA", fontSize: 10, fontWeight: "900", letterSpacing: 1.5 },
  panelTitle: { color: "#F7F5FF", fontSize: 22, fontWeight: "800", marginTop: 10, marginBottom: 16 },
  input: { minHeight: 125, backgroundColor: "#11111B", borderWidth: 1, borderColor: "#39394D", borderRadius: 14, padding: 14, color: "#F7F5FF", fontSize: 14, lineHeight: 21 },
  counter: { color: "#777789", fontSize: 10, textAlign: "right", marginTop: 7 },
  label: { color: "#C6C2D5", fontSize: 10, fontWeight: "800", letterSpacing: 1.2, marginTop: 22, marginBottom: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 13, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: "#414155", backgroundColor: "#20202E" },
  chipActive: { backgroundColor: "#6D4BC3", borderColor: "#A78BFA" },
  chipText: { color: "#C4C1D0", fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  primary: { marginTop: 26, borderRadius: 14, backgroundColor: "#8B5CF6", minHeight: 54, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  primaryText: { color: "#fff", fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  arrow: { color: "#fff", fontSize: 22 },
  note: { color: "#858397", fontSize: 11, lineHeight: 17, marginTop: 14 },
  body: { color: "#B8B6C5", fontSize: 13, lineHeight: 21 },
  scene: { borderTopWidth: 1, borderTopColor: "#343447", marginTop: 18, paddingTop: 16 },
  sceneTitle: { color: "#D8CCFF", fontSize: 15, fontWeight: "800", marginBottom: 8 },
  dialogue: { color: "#A78BFA", fontSize: 13, fontStyle: "italic", marginTop: 9 },
  secondary: { borderWidth: 1, borderColor: "#8B5CF6", borderRadius: 12, padding: 15, alignItems: "center", marginTop: 22 },
  secondaryText: { color: "#C4B5FD", fontWeight: "800", fontSize: 11, letterSpacing: 1 },
  footer: { color: "#696779", fontSize: 9, textAlign: "center", letterSpacing: 1.5, marginTop: 22 }
});