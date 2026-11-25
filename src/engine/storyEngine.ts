/**
 * Story pre-production engine.
 *
 * This module is deliberately local and deterministic: it does not pretend to
 * be a generative AI. It prepares a consistent scene plan and production
 * prompts that a future image/video model adapter can consume.
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
  visualStyle: string;
  continuityRules: string[];
  scenes: PlannedScene[];
  generatedBy: "local-template";
};

const VISUAL_STYLE =
  "animação 2D cinematográfica com acabamento de anime, composição detalhada, " +
  "personagens expressivos, cenários ricos, iluminação dramática, sombras suaves, " +
  "profundidade 2.5D, cores coerentes, qualidade de longa-metragem";

const GENRE_ACTION: Record<Genre, string[]> = {
  Aventura: [
    "O protagonista é apresentado em seu ambiente e percebe algo fora do comum.",
    "Um obstáculo inesperado bloqueia o caminho e exige uma escolha.",
    "O protagonista toma iniciativa e enfrenta a consequência da decisão.",
    "A situação encontra uma conclusão e deixa uma possibilidade para outra jornada.",
  ],
  Comédia: [
    "Uma situação cotidiana apresenta o protagonista e seu objetivo.",
    "Um mal-entendido ou contratempo aumenta a confusão.",
    "Uma tentativa exagerada de resolver tudo provoca uma reviravolta.",
    "A confusão termina com uma conclusão visual engraçada.",
  ],
  Fantasia: [
    "O protagonista descobre um elemento extraordinário em um lugar familiar.",
    "Uma regra ou ameaça do mundo fantástico é revelada.",
    "O protagonista usa uma descoberta para mudar o rumo do conflito.",
    "O mistério principal se resolve e o mundo revela um novo segredo.",
  ],
  Ação: [
    "A cena abre com o protagonista e a ameaça claramente estabelecidos.",
    "O perigo se aproxima e força uma reação imediata.",
    "Uma sequência de ação muda a vantagem entre os envolvidos.",
    "O confronto termina com uma consequência clara.",
  ],
  Drama: [
    "O protagonista é apresentado diante de uma situação emocional importante.",
    "Uma dificuldade coloca relações ou objetivos em conflito.",
    "Uma decisão difícil revela o que realmente importa.",
    "A história encerra com uma mudança emocional perceptível.",
  ],
  Mistério: [
    "Um detalhe estranho chama a atenção do protagonista.",
    "Pistas contraditórias tornam o caso mais complexo.",
    "Uma descoberta conecta elementos que pareciam separados.",
    "A principal pergunta é respondida, com espaço para novas dúvidas.",
  ],
};

const SHOTS: ShotType[] = [
  "plano geral",
  "plano médio",
  "plano de ação",
  "close cinematográfico",
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

function makeScene(
  index: number,
  premise: string,
  genre: Genre,
  characterDescription: string,
): PlannedScene {
  const actions = GENRE_ACTION[genre];
  const action = actions[index];
  const shot = SHOTS[index];
  const camera = CAMERAS[index];
  const lighting = LIGHTING[index];

  return {
    id: `scene-${index + 1}`,
    title: [
      "Apresentação",
      "O conflito",
      "A virada",
      "Desfecho",
    ][index],
    purpose: action,
    action,
    dialogue: [
      "Eu ainda não sei o que está por vir.",
      "Isso ficou mais complicado do que eu imaginava!",
      "Preciso agir agora.",
      "Essa experiência mudou tudo.",
    ][index],
    shot,
    camera,
    lighting,
    imagePrompt:
      `${VISUAL_STYLE}. ${shot}; ${lighting}. ` +
      `Personagem: ${characterDescription}. ` +
      `Ação visual: ${action} Ideia central da história: ${premise}. ` +
      "Manter design, rosto, roupa, proporções e paleta do personagem idênticos " +
      "às demais cenas. Sem texto, legendas, logotipos ou marcas d'água.",
    videoPrompt:
      `Animar a imagem como uma cena contínua de animação 2D cinematográfica. ` +
      `${camera}; ação: ${action} ` +
      `Expressões naturais, movimento corporal coerente, cenário com profundidade 2.5D. ` +
      `Iluminação: ${lighting}. Preservar rigorosamente o design do personagem.`,
  };
}

/**
 * Produces a four-beat storyboard and ready-to-adapt visual prompts.
 * It is a planning tool, not an image or video generator.
 */
export function createStoryPlan(
  idea: string,
  genre: Genre,
  duration: string,
  characterDescription = "personagem principal a definir; manter aparência consistente",
): StoryPlan {
  const premise = cleanPremise(idea);
  if (!premise) {
    throw new Error("Escreva uma ideia antes de criar o projeto.");
  }

  return {
    title: premise.length > 42 ? premise.slice(0, 42).trim() + "…" : premise,
    premise,
    genre,
    duration,
    visualStyle: VISUAL_STYLE,
    continuityRules: [
      "Usar a mesma referência visual do personagem em todas as cenas.",
      "Não alterar rosto, cabelo, roupa, proporções ou paleta sem autorização.",
      "Manter o estilo 2D cinematográfico e a direção de arte entre cenas.",
      "Preservar a geografia do cenário e a direção dos movimentos.",
      "Cada cena deve começar e terminar em um estado visual compreensível.",
    ],
    scenes: [0, 1, 2, 3].map((index) =>
      makeScene(index, premise, genre, characterDescription),
    ),
    generatedBy: "local-template",
  };
}

export function buildProductionPrompt(plan: StoryPlan): string {
  return [
    "PROJETO DE ANIMAÇÃO",
    plan.title,
    `Gênero: ${plan.genre}`,
    `Duração desejada: ${plan.duration}`,
    `Direção visual: ${plan.visualStyle}`,
    "",
    "REGRAS DE CONTINUIDADE",
    ...plan.continuityRules.map((rule) => `- ${rule}`),
    "",
    ...plan.scenes.flatMap((scene, index) => [
      `CENA ${index + 1}: ${scene.title}`,
      `Objetivo: ${scene.purpose}`,
      `Fala: ${scene.dialogue}`,
      `Prompt de imagem: ${scene.imagePrompt}`,
      `Prompt de animação: ${scene.videoPrompt}`,
      "",
    ]),
    "NOTA: este plano foi preparado localmente. Nenhuma imagem ou vídeo foi gerado.",
  ].join("\n");
}
