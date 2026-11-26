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
  continuityRules: string[];
  scenes: PlannedScene[];
  generatedBy: "local-template" | "ai-provider";
};

const VISUAL_STYLE =
  "animação 2D cinematográfica com acabamento de anime, composição detalhada, " +
  "personagens expressivos, cenários ricos, iluminação dramática, sombras suaves, " +
  "profundidade 2.5D, cores coerentes, qualidade de longa-metragem";

const GENRE_BEATS: Record<Genre, string[]> = {
  Aventura: [
    "O protagonista é apresentado em seu ambiente e percebemos seu objetivo.",
    "Um acontecimento inesperado coloca a jornada em movimento.",
    "O caminho revela pistas, aliados ou recursos importantes.",
    "Um obstáculo inesperado bloqueia o avanço e exige uma escolha.",
    "A escolha provoca uma consequência que aumenta o desafio.",
    "O protagonista descobre uma nova possibilidade de agir.",
    "A tensão cresce e o objetivo parece mais distante.",
    "O protagonista enfrenta o maior desafio da jornada.",
    "A ação decisiva muda o rumo do conflito.",
    "As consequências da aventura aparecem e a história encontra seu desfecho.",
  ],
  Comédia: [
    "Uma situação cotidiana apresenta o protagonista e seu objetivo.",
    "Um detalhe inesperado dá início à confusão.",
    "O protagonista tenta resolver o problema de maneira simples.",
    "Um mal-entendido aumenta a confusão.",
    "Uma tentativa exagerada provoca um novo contratempo.",
    "A situação sai completamente do controle.",
    "O protagonista acredita ter encontrado uma solução.",
    "A solução provoca a maior reviravolta cômica.",
    "A confusão chega ao seu ponto máximo.",
    "Tudo termina com uma consequência inesperada e engraçada.",
  ],
  Fantasia: [
    "O protagonista é apresentado em um lugar aparentemente comum.",
    "Um elemento extraordinário surge e chama sua atenção.",
    "Uma descoberta revela que o mundo esconde regras especiais.",
    "O protagonista encontra alguém ou algo ligado ao mistério.",
    "Uma ameaça revela o risco de continuar a jornada.",
    "Uma pista muda tudo o que o protagonista acreditava.",
    "O poder ou segredo central começa a se manifestar.",
    "O protagonista precisa enfrentar a força que ameaça esse mundo.",
    "A descoberta decisiva muda o equilíbrio do conflito.",
    "O mistério principal se resolve e um novo segredo pode surgir.",
  ],
  Ação: [
    "A cena apresenta o protagonista, o objetivo e a ameaça.",
    "Um sinal de perigo anuncia o confronto.",
    "A ameaça se aproxima e força uma reação imediata.",
    "O primeiro confronto revela a força do adversário.",
    "O protagonista muda de estratégia para sobreviver.",
    "Uma perseguição ou confronto aumenta a pressão.",
    "O adversário parece conquistar vantagem.",
    "O protagonista encontra uma abertura para reagir.",
    "O confronto decisivo atinge seu ponto máximo.",
    "A ação termina com uma consequência clara para a história.",
  ],
  Drama: [
    "O protagonista é apresentado diante de uma situação emocional importante.",
    "Um acontecimento altera sua rotina ou suas relações.",
    "A dificuldade começa a afetar seus objetivos.",
    "Uma conversa revela sentimentos ou conflitos escondidos.",
    "Uma decisão difícil coloca valores em choque.",
    "As consequências da decisão ficam mais claras.",
    "O protagonista enfrenta aquilo que vinha evitando.",
    "Um gesto ou revelação muda a relação entre os personagens.",
    "O momento decisivo revela o que realmente importa.",
    "A história encerra com uma mudança emocional perceptível.",
  ],
  Mistério: [
    "Um detalhe estranho chama a atenção do protagonista.",
    "A primeira investigação revela uma pista.",
    "Uma nova evidência levanta mais perguntas.",
    "Uma pista contraditória coloca a hipótese em dúvida.",
    "O protagonista encontra uma conexão inesperada.",
    "Uma descoberta aumenta o risco da investigação.",
    "Uma falsa conclusão ameaça desviar o caminho.",
    "A pista decisiva conecta elementos antes separados.",
    "O protagonista confronta a verdade por trás do mistério.",
    "A principal pergunta é respondida, com espaço para novas dúvidas.",
  ],
};

const GENRE_DIALOGUE: Record<Genre, string[]> = {
  Aventura: [
    "Hoje é o começo da minha jornada.",
    "Não esperava encontrar isso pelo caminho.",
    "Preciso descobrir onde essa pista vai me levar.",
    "Se eu parar agora, nunca vou saber a verdade.",
    "Essa escolha pode mudar tudo.",
    "Talvez eu tenha subestimado esse desafio.",
    "Ainda existe uma chance. Preciso encontrá-la.",
    "Chegou a hora de enfrentar o que está à minha frente.",
    "Agora entendi o que preciso fazer.",
    "A jornada acabou, mas eu não sou mais o mesmo.",
  ],
  Comédia: [
    "Pelo menos o plano parecia bom na minha cabeça.",
    "Como foi que isso ficou tão complicado?",
    "Calma. Eu consigo resolver isso... eu acho.",
    "Tenho quase certeza de que entendi errado.",
    "Ótimo. Era exatamente disso que eu precisava.",
    "Isso está ficando muito pior do que imaginei.",
    "Dessa vez vai dar certo. Provavelmente.",
    "Alguém pode me explicar o que acabou de acontecer?",
    "Não era essa a solução que eu tinha em mente.",
    "No fim, acho que até valeu a confusão.",
  ],
  Fantasia: [
    "Sinto que este lugar esconde algo extraordinário.",
    "Isso não pode ser apenas uma coincidência.",
    "Talvez a resposta esteja neste símbolo.",
    "Preciso descobrir as regras deste mundo.",
    "Agora entendo por que todos tinham medo.",
    "O que eu sabia até agora estava incompleto.",
    "Há algo despertando dentro de mim.",
    "Não vou deixar que esse poder destrua tudo.",
    "Finalmente encontrei a origem do mistério.",
    "A magia terminou, mas a aventura continua.",
  ],
  Ação: [
    "Não temos tempo. Precisamos sair daqui!",
    "Fiquem atrás de mim!",
    "Ele está mais perto do que eu pensava.",
    "Não vou deixar que passe por nós.",
    "Mudar de estratégia é nossa única chance.",
    "Continuem em movimento!",
    "Isso ainda não acabou.",
    "Agora é a minha vez de reagir.",
    "É tudo ou nada!",
    "Conseguimos escapar, mas o perigo não terminou.",
  ],
  Drama: [
    "Eu nunca imaginei que chegaria a este ponto.",
    "Não sei se estou pronto para isso.",
    "Há coisas que eu nunca consegui dizer.",
    "Preciso ser sincero, mesmo que doa.",
    "Não posso continuar fugindo dessa decisão.",
    "Eu queria que tudo fosse diferente.",
    "Talvez esteja na hora de enfrentar meus medos.",
    "Agora consigo entender o que você sentia.",
    "Finalmente sei o que realmente importa.",
    "Nem tudo voltou ao normal, mas podemos recomeçar.",
  ],
  Mistério: [
    "Tem alguma coisa errada nesta história.",
    "Essa pista não estava aqui por acaso.",
    "Preciso comparar isso com o que encontrei antes.",
    "Então por que as versões não combinam?",
    "Existe uma ligação que ainda não percebi.",
    "Alguém está tentando esconder a verdade.",
    "Talvez eu esteja seguindo a pista errada.",
    "Agora todas as peças começam a se encaixar.",
    "Está na hora de descobrir quem fez isso.",
    "O caso está resolvido, mas uma pergunta permanece.",
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

function durationInSeconds(duration: string): number {
  const normalized = duration.toLowerCase();
  const minutes = normalized.match(/(\d+(?:[.,]\d+)?)\s*min/);
  const seconds = normalized.match(/(\d+(?:[.,]\d+)?)\s*seg/);
  if (minutes) return Math.max(15, Math.round(Number(minutes[1].replace(",", ".")) * 60));
  if (seconds) return Math.max(10, Math.round(Number(seconds[1].replace(",", "."))));
  return 60;
}

/** Estima uma cena a cada ~8 segundos, sem teto artificial de quatro cenas. */
function sceneCountFor(duration: string): number {
  return Math.max(4, Math.ceil(durationInSeconds(duration) / 8));
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
    dialogue: GENRE_DIALOGUE[genre][index % GENRE_DIALOGUE[genre].length],
    shot,
    camera,
    lighting,
    imagePrompt:
      `${VISUAL_STYLE}. ${shot}; ${lighting}. ` +
      `Cena ${sceneNumber} de ${total}. Personagem: ${characterDescription}. ` +
      `Ação visual: ${action} Ideia central: ${premise}. ` +
      "Manter design, rosto, roupa, proporções e paleta do personagem idênticos às demais cenas. " +
      "Sem texto, legendas, logotipos ou marcas d'água.",
    videoPrompt:
      "Animar a imagem como uma cena contínua de animação 2D cinematográfica. " +
      `${camera}; ação: ${action} ` +
      "Expressões naturais, movimento corporal coerente, cenário com profundidade 2.5D. " +
      `Iluminação: ${lighting}. ` +
      "Preservar rigorosamente o design do personagem e terminar em uma pose que permita continuidade.",
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
  characterDescription = "personagem principal a definir; manter aparência consistente",
): StoryPlan {
  const premise = cleanPremise(idea);
  if (!premise) throw new Error("Escreva uma ideia antes de criar o projeto.");

  const estimatedSeconds = durationInSeconds(duration);
  const count = sceneCountFor(duration);
  const scenes = Array.from({ length: count }, (_, index) =>
    makeScene(index, count, premise, genre, characterDescription),
  );

  return {
    title: premise.length > 42 ? premise.slice(0, 42).trim() + "…" : premise,
    premise,
    genre,
    duration,
    estimatedSeconds,
    visualStyle: VISUAL_STYLE,
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
      `Fala: ${scene.dialogue}`,
      `Prompt de imagem: ${scene.imagePrompt}`,
      `Prompt de animação: ${scene.videoPrompt}`,
      "",
    ]),
    "NOTA: este plano foi preparado localmente. Nenhuma imagem ou vídeo foi gerado.",
  ].join("\n");
}
