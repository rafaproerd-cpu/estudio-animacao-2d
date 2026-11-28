/**
 * Planejador local de pré-produção.
 *
 * Ele organiza a história em uma quantidade variável de cenas. Ainda não é
 * um modelo generativo e não produz imagens, áudio ou vídeo.
 */

export type Genre =
  | "Aventura"
  | "Comédia"
  | "Fantasia"
  | "Ação"
  | "Drama"
  | "Mistério";

export type ShotType =
  | "plano geral"
  | "plano médio"
  | "close cinematográfico"
  | "plano de ação";

export type CameraMove =
  | "travelling lento de aproximação"
  | "panorâmica suave"
  | "câmera acompanha o personagem"
  | "câmera estável com leve movimento de profundidade";

export type PlannedScene = {
  id: string;
  title: string;
  purpose: string;
  action: string;
  dialogue: string;
  shot: ShotType;
  camera: CameraMove;
  lighting: string;
  imagePrompt: string;
  videoPrompt: string;
};

export type StoryPlan = {
  title: string;
  premise: string;
  genre: Genre;
  duration: string;
  estimatedSeconds: number;
  visualStyle: string;
  characterBible?: string;
  continuityRules: string[];
  scenes: PlannedScene[];
  generatedBy: "local-template" | "ai-provider";
};

const VISUAL_STYLE_BY_GENRE: Record<Genre, string> = {
  Aventura: "animação 2D de aventura, cenários amplos e coloridos, composição cinematográfica, personagens expressivos e profundidade 2.5D",
  Comédia: "animação 2D cartoon estilizada, formas claras, expressões exageradas, timing visual divertido e cores vivas",
  Fantasia: "animação 2D de fantasia, cenários imaginativos, efeitos mágicos desenhados, iluminação atmosférica e profundidade 2.5D",
  Ação: "animação 2D de ação, poses dinâmicas, linhas de movimento, enquadramentos energéticos e leitura visual clara",
  Drama: "animação 2D cinematográfica, atuação corporal sutil, expressões emocionais, composição delicada e iluminação natural",
  Mistério: "animação 2D de suspense, cenários detalhados, sombras expressivas, paleta atmosférica e enquadramentos de investigação",
};

const GENRE_BEATS: Record<Genre, string[]> = {
  Aventura: [
    "A jornada começa em um lugar familiar, onde um grande objetivo está prestes a mudar tudo.",
    "Um acontecimento inesperado coloca os primeiros passos dessa aventura em movimento.",
    "No caminho, surgem pistas e encontros que revelam novas possibilidades.",
    "Mas um obstáculo inesperado ameaça impedir que a jornada continue.",
    "Uma escolha difícil traz consequências e torna o desafio ainda maior.",
    "Quando tudo parece complicado, uma nova possibilidade aparece.",
    "O objetivo parece distante, e a tensão cresce a cada tentativa.",
    "Chega o momento de enfrentar o maior desafio de toda a jornada.",
    "Uma atitude decisiva muda o rumo dos acontecimentos.",
    "Depois de tantos desafios, chega a hora de descobrir o resultado dessa aventura.",
  ],
  Comédia: [
    "Tudo começa com um plano simples, que parecia impossível de dar errado.",
    "Mas um pequeno imprevisto transforma a tranquilidade em confusão.",
    "Na tentativa de resolver o problema, surge uma situação ainda mais engraçada.",
    "Um mal-entendido faz tudo sair do controle.",
    "A próxima tentativa parece uma boa ideia, até que algo dá errado novamente.",
    "Em pouco tempo, a confusão toma proporções inesperadas.",
    "Quando finalmente aparece uma solução, um detalhe muda tudo.",
    "Uma reviravolta transforma o plano em uma trapalhada inesquecível.",
    "No momento mais complicado, tudo acontece ao mesmo tempo.",
    "No fim, o resultado é completamente diferente do esperado.",
  ],
  Fantasia: [
    "Em um mundo aparentemente comum, algo extraordinário está prestes a despertar.",
    "Um sinal misterioso revela que aquele lugar guarda um segredo antigo.",
    "A cada descoberta, novas regras daquele mundo começam a aparecer.",
    "Uma presença inesperada mostra que existe algo muito maior por trás do mistério.",
    "Logo, fica claro que continuar a jornada também envolve grandes riscos.",
    "Uma pista surpreendente muda tudo o que parecia conhecido.",
    "Enquanto um poder oculto desperta, o equilíbrio daquele mundo começa a mudar.",
    "Chega a hora de enfrentar a força que ameaça aquele lugar.",
    "Uma descoberta decisiva muda o rumo do conflito.",
    "O mistério encontra uma resposta, mas aquele mundo ainda guarda segredos.",
  ],
  Ação: [
    "A tranquilidade termina quando uma ameaça surge e coloca tudo em risco.",
    "Um sinal de perigo anuncia que o confronto está prestes a começar.",
    "Com a ameaça cada vez mais próxima, cada segundo passa a importar.",
    "O primeiro confronto revela que o adversário é mais forte do que parecia.",
    "Sem outra saída, uma nova estratégia precisa entrar em ação.",
    "A perseguição aumenta a pressão e deixa poucas chances de escapar.",
    "Por um instante, parece que o adversário está prestes a vencer.",
    "Uma oportunidade inesperada permite uma reação decisiva.",
    "No confronto final, cada movimento pode mudar o resultado.",
    "Quando a ameaça passa, suas consequências finalmente aparecem.",
  ],
  Drama: [
    "Tudo segue normalmente até que um acontecimento muda aquela rotina.",
    "A mudança traz sentimentos difíceis e coloca antigas certezas em dúvida.",
    "Aos poucos, a dificuldade começa a afetar os planos e as relações.",
    "Um momento revelador traz à tona sentimentos que estavam escondidos.",
    "Uma decisão difícil coloca o coração e a razão em lados opostos.",
    "As consequências mostram que não é possível voltar ao que era antes.",
    "Chega o momento de enfrentar aquilo que foi evitado por tanto tempo.",
    "Um gesto sincero abre espaço para uma nova compreensão.",
    "A escolha final revela o que realmente tem valor naquela história.",
    "Nem tudo volta a ser como antes, mas um novo começo se torna possível.",
  ],
  Mistério: [
    "Um detalhe aparentemente insignificante desperta a primeira suspeita.",
    "A investigação começa e revela uma pista que não deveria estar ali.",
    "Uma nova evidência traz perguntas ainda mais difíceis.",
    "Uma contradição coloca a primeira explicação em dúvida.",
    "Aos poucos, uma conexão inesperada começa a surgir.",
    "Uma descoberta aumenta o perigo e mostra que algo está sendo escondido.",
    "Uma conclusão precipitada quase desvia a investigação do caminho certo.",
    "A pista decisiva reúne detalhes que pareciam não ter relação.",
    "Ao encarar a verdade, o mistério finalmente começa a se revelar.",
    "O caso encontra uma resposta, mas um último detalhe ainda chama atenção.",
  ],
};

const GENRE_NARRATION: Record<Genre, string[]> = {
  Aventura: [
    "Tudo parecia normal até surgir um imprevisto.",
    "Uma pista apontou para um caminho desconhecido.",
    "O primeiro obstáculo colocou a jornada em risco.",
    "Uma escolha difícil mudou o rumo da viagem.",
    "As consequências tornaram o desafio ainda maior.",
    "Uma descoberta revelou uma nova possibilidade.",
    "O objetivo parecia cada vez mais distante.",
    "Chegou a hora de enfrentar o maior desafio.",
    "Uma atitude decisiva mudou o destino da aventura.",
    "Depois de tantos desafios, a jornada encontrou seu fim.",
  ],
  Comédia: [
    "Tudo começou com um plano aparentemente simples.",
    "Um detalhe inesperado deu início à confusão.",
    "A primeira tentativa acabou saindo errado.",
    "Um mal-entendido deixou tudo ainda mais complicado.",
    "Outra ideia trouxe um problema ainda maior.",
    "A situação saiu completamente do controle.",
    "Por um instante, tudo pareceu resolvido.",
    "Mas a solução provocou uma confusão ainda maior.",
    "A trapalhada chegou ao seu ponto máximo.",
    "No fim, ninguém esperava aquele resultado.",
  ],
  Fantasia: [
    "Um dia comum revelou algo extraordinário.",
    "Uma luz misteriosa surgiu diante do protagonista.",
    "A descoberta revelou regras desconhecidas daquele mundo.",
    "Uma presença inesperada trouxe novas respostas.",
    "Uma ameaça colocou aquele mundo em perigo.",
    "Uma pista revelou um segredo surpreendente.",
    "Um poder oculto começou a despertar.",
    "Chegou a hora de enfrentar a ameaça.",
    "Uma descoberta mudou o equilíbrio daquele mundo.",
    "O mistério terminou, mas outro segredo surgiu.",
  ],
  Ação: [
    "A tranquilidade terminou quando o perigo apareceu.",
    "Um sinal anunciou que algo estava chegando.",
    "A ameaça se aproximou rapidamente.",
    "O primeiro confronto revelou um adversário poderoso.",
    "Uma nova estratégia abriu caminho para escapar.",
    "A perseguição ficou cada vez mais intensa.",
    "O adversário parecia estar vencendo.",
    "Uma oportunidade permitiu que o protagonista reagisse.",
    "O confronto decisivo chegou ao seu limite.",
    "Quando tudo terminou, nada ficou como antes.",
  ],
  Drama: [
    "Tudo parecia normal, mas algo estava diferente.",
    "Um acontecimento mudou a rotina do protagonista.",
    "A dificuldade começou a afetar seus planos.",
    "Sentimentos escondidos vieram à tona.",
    "Uma decisão difícil mudou tudo.",
    "As consequências ficaram impossíveis de ignorar.",
    "Chegou a hora de enfrentar o passado.",
    "Um gesto inesperado aproximou os personagens.",
    "O momento decisivo revelou o que importava.",
    "Uma mudança profunda marcou aquele novo começo.",
  ],
  Mistério: [
    "Um detalhe estranho chamou a atenção.",
    "A primeira investigação revelou uma pista.",
    "Uma nova evidência levantou outras perguntas.",
    "Uma contradição colocou a hipótese em dúvida.",
    "Uma conexão inesperada começou a surgir.",
    "A descoberta aumentou o risco da investigação.",
    "Uma conclusão precipitada quase enganou o protagonista.",
    "A pista decisiva conectou todos os acontecimentos.",
    "A verdade finalmente veio à tona.",
    "O mistério foi resolvido, mas restaram dúvidas.",
  ],
};

const BEAT_PROGRESSIONS = [
  "Estabelecer visualmente a situação e a posição dos personagens.",
  "Mostrar uma reação ou detalhe novo que avance o momento.",
  "Aproximar a câmera da consequência emocional ou física da ação.",
  "Preparar uma transição visual clara para o próximo acontecimento.",
];

const PHASE_TITLES = [
  "Abertura", "O chamado", "Primeiras pistas", "O desafio",
  "Complicações", "Nova descoberta", "A tensão aumenta",
  "O grande confronto", "A virada decisiva", "Desfecho",
];

const SHOTS: ShotType[] = [
  "plano geral", "plano médio", "plano de ação", "close cinematográfico",
];
const CAMERAS: CameraMove[] = [
  "travelling lento de aproximação",
  "câmera acompanha o personagem",
  "panorâmica suave",
  "câmera estável com leve movimento de profundidade",
];
const LIGHTING = [
  "luz ambiente suave com sombras longas",
  "contraluz dramática e partículas no ar",
  "luz lateral cinematográfica com contraste controlado",
  "iluminação quente de encerramento com sombras suaves",
];

function cleanPremise(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 700);
}

function openingNarration(premise: string): string {
  const match = premise.match(/^(.+?[.!?])(?: |$)/);
  const firstSentence = (match?.[1] || premise).trim();
  const words = firstSentence.split(" ").filter(Boolean);
  if (words.length <= 8) {
    return /[.!?]$/.test(firstSentence) ? firstSentence : firstSentence + ".";
  }
  return words.slice(0, 7).join(" ") + "…";
}

function durationInSeconds(duration: string): number {
  const normalized = duration.toLowerCase();
  const minutes = normalized.match(/(\d+(?:[.,]\d+)?)\s*min/);
  const seconds = normalized.match(/(\d+(?:[.,]\d+)?)\s*seg/);
  const total =
    (minutes ? Number(minutes[1].replace(",", ".")) * 60 : 0) +
    (seconds ? Number(seconds[1].replace(",", ".")) : 0);
  if (!Number.isFinite(total) || total <= 0) return 60;
  return Math.max(10, Math.round(total));
}

/** Divide a duração em clipes de até ~5 segundos, respeitando o limite do gerador de vídeo. */
function sceneCountFor(duration: string): number {
  return Math.max(4, Math.ceil(durationInSeconds(duration) / 5));
}

function makeScene(
  index: number,
  total: number,
  premise: string,
  genre: Genre,
  characterDescription: string,
): PlannedScene {
  const beats = GENRE_BEATS[genre];
  const progress = total <= 1 ? 0 : index / (total - 1);
  const beatPosition = progress * beats.length;
  const beatIndex = Math.min(beats.length - 1, Math.floor(beatPosition));
  const beatProgress = beatPosition - beatIndex;
  const progressionIndex = Math.min(BEAT_PROGRESSIONS.length - 1, Math.floor(beatProgress * BEAT_PROGRESSIONS.length));
  const action = `${beats[beatIndex]} ${BEAT_PROGRESSIONS[progressionIndex]}`;
  const shot = SHOTS[index % SHOTS.length];
  const camera = CAMERAS[index % CAMERAS.length];
  const lighting = LIGHTING[index % LIGHTING.length];
  const phaseTitle = PHASE_TITLES[Math.min(PHASE_TITLES.length - 1, beatIndex)];
  const sceneNumber = index + 1;

  return {
    id: `scene-${sceneNumber}`,
    title: `Cena ${sceneNumber} — ${phaseTitle}`,
    purpose: action,
    action: `${action} Desenvolver este momento de forma visual e conectá-lo naturalmente à cena anterior e à próxima.`,
    dialogue: index === 0 ? openingNarration(premise) : GENRE_NARRATION[genre][beatIndex],
    shot,
    camera,
    lighting,
    imagePrompt:
      `${VISUAL_STYLE_BY_GENRE[genre]}. ${shot}; ${lighting}. ` +
      `Cena ${sceneNumber} de ${total}. Personagem: ${characterDescription}. ` +
      `Ação visual: ${action} Ideia central: ${premise}. ` +
      "Manter design, rosto, roupa, proporções e paleta do personagem idênticos às demais cenas. " +
      "Sem texto, legendas, logotipos ou marcas d'água.",
    videoPrompt:
      "Transformar a ilustração em uma cena de animação 2D com ação visível do início ao fim, não em uma imagem parada com zoom. " +
      `${camera}; ação principal: ${action} ` +
      "Traduzir a narração em uma ação física clara: o personagem deve deslocar o corpo, usar braços e mãos, olhar para o que está fazendo e interagir com objetos ou elementos do cenário que já estejam na ilustração. " +
      "Mostrar uma pequena progressão em três momentos: preparação da ação, execução com movimento corporal e reação/pose final. " +
      "Usar expressões faciais e linguagem corporal coerentes com a emoção da cena; incluir movimento secundário discreto no ambiente apenas quando houver elementos visíveis. " +
      "Manter anatomia estável, sem deformações, sem trocar rosto, cabelo, roupa, cores, proporções ou identidade. " +
      "A câmera pode complementar a ação, mas nunca substituir o movimento do personagem. " +
      "Áudio será apenas narração externa adicionada depois: personagens não falam, sem diálogo, sem lip-sync, sem legendas, sem texto na tela e sem trilha sonora gerada. " +
      `Iluminação: ${lighting}. ` +
      "Encerrar em uma pose natural que permita continuidade com a próxima cena.",
  };
}

/**
 * Cria um storyboard com quantidade de cenas proporcional à duração escolhida.
 * O texto ainda é organizado por regras locais, não por IA generativa.
 */
export function createStoryPlan(
  idea: string,
  genre: Genre,
  duration: string,
  characterDescription = "personagem principal com aparência definida pela história; manter aparência consistente",
): StoryPlan {
  const premise = cleanPremise(idea);
  if (!premise) throw new Error("Escreva uma ideia antes de criar o projeto.");

  const estimatedSeconds = durationInSeconds(duration);
  const count = sceneCountFor(duration);
  const scenes = Array.from({ length: count }, (_, index) =>
    makeScene(index, count, premise, genre, characterDescription),
  );

  // Acrescenta âncoras narrativas entre cenas consecutivas. Isso orienta os
  // prompts a mostrar uma progressão, sem prometer identidade visual perfeita.
  scenes.forEach((scene, index) => {
    const previous = scenes[index - 1];
    const next = scenes[index + 1];
    const continuity = previous
      ? `Continuidade: esta cena acontece depois de "${previous.title}". Retomar a consequência da ação anterior: ${previous.action} Não reiniciar a história nem voltar à pose inicial; mostrar o próximo acontecimento como consequência.`
      : "Continuidade: estabelecer claramente a posição inicial do personagem, os objetos importantes e a geografia do cenário que serão retomados nas próximas cenas.";
    const handoff = next
      ? `Preparar a próxima cena: "${next.title}" — ${next.action} Terminar com posição corporal, direção do olhar e estado dos objetos que permitam essa transição.`
      : "Desfecho: mostrar a consequência final da jornada e encerrar a ação com uma pose natural, sem introduzir um novo conflito.";
    scene.imagePrompt += ` ${continuity} ${handoff}`;
    scene.videoPrompt += ` ${continuity} ${handoff} Preservar a direção do movimento e a posição relativa dos elementos entre o início e o fim do clipe.`;
  });

  return {
    title: premise.length > 42 ? premise.slice(0, 42).trim() + "…" : premise,
    premise,
    genre,
    duration,
    estimatedSeconds,
    visualStyle: VISUAL_STYLE_BY_GENRE[genre],
    continuityRules: [
      "Usar a mesma referência visual do personagem em todas as cenas.",
      "Não alterar rosto, cabelo, roupa, proporções ou paleta sem autorização.",
      "Manter o estilo 2D cinematográfico e a direção de arte entre cenas.",
      "Preservar a geografia do cenário e a direção dos movimentos.",
      "Cada cena deve começar e terminar em um estado visual compreensível.",
      "Distribuir a história por todas as cenas necessárias, sem encerrar artificialmente após quatro.",
    ],
    scenes,
    generatedBy: "local-template",
  };
}

export function buildProductionPrompt(plan: StoryPlan): string {
  return [
    "PROJETO DE ANIMAÇÃO",
    plan.title,
    `Gênero: ${plan.genre}`,
    `Duração desejada: ${plan.duration}`,
    `Quantidade de cenas: ${plan.scenes.length}`,
    `Direção visual: ${plan.visualStyle}`,
    "",
    "REGRAS DE CONTINUIDADE",
    ...plan.continuityRules.map((rule) => `- ${rule}`),
    "",
    ...plan.scenes.flatMap((scene, index) => [
      `CENA ${index + 1}: ${scene.title}`,
      `Objetivo: ${scene.purpose}`,
      `Narração externa: ${scene.dialogue}`,
      `Prompt de imagem: ${scene.imagePrompt}`,
      `Prompt de animação: ${scene.videoPrompt}`,
      "",
    ]),
    "NOTA: este plano foi preparado localmente. Nenhuma imagem ou vídeo foi gerado.",
  ].join("\n");
}
