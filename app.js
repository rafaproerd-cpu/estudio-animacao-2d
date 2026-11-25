const form = document.querySelector("#creator-form");
const ideaInput = document.querySelector("#idea");
const charCount = document.querySelector("#char-count");
const result = document.querySelector("#result");
const output = document.querySelector("#story-output");
let latestScript = "";

ideaInput.addEventListener("input", () => {
  charCount.textContent = ideaInput.value.length + "/700";
});

function cleanTitle(text) {
  const first = text.trim().split(/[.!?\n]/)[0];
  return first.length > 58 ? first.slice(0, 55).trim() + "..." : first;
}
function makeScript(idea, genre, duration) {
  const title = cleanTitle(idea) || "Uma nova aventura";
  const seconds = duration === "30 segundos" ? 30 : duration === "1 minuto" ? 60 : duration === "2 minutos" ? 120 : 180;
  const count = seconds <= 30 ? 3 : seconds <= 60 ? 4 : seconds <= 120 ? 6 : 8;
  const beats = [
    ["A descoberta", "Apresente o personagem principal e o mundo em que ele vive. Algo inesperado chama sua atenção."],
    ["O chamado", "A ideia ganha força: surge um desafio que o personagem não pode ignorar."],
    ["A primeira tentativa", "O personagem tenta resolver a situação, mas encontra um obstáculo que muda seus planos."],
    ["A virada", "Uma pista ou ajuda inesperada revela uma nova possibilidade. O personagem decide continuar."],
    ["O grande desafio", "Chega o momento mais difícil. O personagem precisa usar o que aprendeu para seguir em frente."],
    ["A escolha", "Uma decisão importante mostra quem o personagem realmente é."],
    ["O resultado", "A ação principal acontece e as consequências ficam claras."],
    ["O gancho final", "Feche a história com uma imagem marcante ou uma pequena surpresa que deixe vontade de ver mais."]
  ];
  const scenes = beats.slice(0, count).map((beat, i) => ({
    name: beat[0],
    visual: beat[1],
    dialogue: i === 0 ? "NARRADOR: Tudo começou quando uma situação comum se transformou em algo extraordinário..." :
      i === count - 1 ? "PERSONAGEM: Essa aventura ainda não acabou!" :
      ["PERSONAGEM: O que está acontecendo?","PERSONAGEM: Eu preciso descobrir uma saída.","PERSONAGEM: Não vou desistir agora.","PERSONAGEM: Acho que finalmente entendi!"][i % 4]
  }));
  const characters = [
    {name:"Protagonista", description:"Personagem principal. Curioso, expressivo e com um objetivo claro que move a história."},
    {name:"Companheiro ou aliado", description:"Ajuda o protagonista e traz personalidade, humor ou uma nova perspectiva."},
    {name:"Desafio / antagonista", description:"A força que dificulta o objetivo e cria tensão para a aventura."}
  ];
  return {title,genre,duration,idea,characters,scenes};
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
}
function renderScript(script) {
  const chars = script.characters.map(c => `<li><strong>${escapeHtml(c.name)}:</strong> ${escapeHtml(c.description)}</li>`).join("");
  const scenes = script.scenes.map((s,i) => `<div class="scene"><strong>CENA ${i+1} — ${escapeHtml(s.name)}</strong><p><b>Visual:</b> ${escapeHtml(s.visual)}</p><p><b>Áudio:</b> ${escapeHtml(s.dialogue)}</p></div>`).join("");
  output.innerHTML = `<h3 class="story-title">${escapeHtml(script.title)}</h3><div class="story-meta">${escapeHtml(script.genre.toUpperCase())} · ${escapeHtml(script.duration)}</div>
    <div class="story-block"><h3>IDEIA ORIGINAL</h3><p>${escapeHtml(script.idea)}</p></div>
    <div class="story-block"><h3>PERSONAGENS</h3><ul>${chars}</ul></div>
    <div class="story-block"><h3>ROTEIRO E CENAS</h3>${scenes}</div>
    <div class="story-block"><h3>PRÓXIMA ETAPA</h3><p>Definir aparência visual fixa dos personagens, criar imagens de referência e depois planejar movimentos, vozes e montagem do vídeo.</p></div>`;
}
function scriptAsText(s) {
  return [s.title, `Gênero: ${s.genre} | Duração: ${s.duration}`, "", "IDEIA", s.idea, "", "PERSONAGENS", ...s.characters.map(c => `- ${c.name}: ${c.description}`), "", "CENAS", ...s.scenes.flatMap((c,i) => [`CENA ${i+1} — ${c.name}`, `Visual: ${c.visual}`, `Áudio: ${c.dialogue}`, ""]), "Próxima etapa: definir referências visuais, movimentos, vozes e montagem."].join("\n");
}
form.addEventListener("submit", event => {
  event.preventDefault();
  const idea = ideaInput.value.trim();
  if (!idea) return;
  latestScript = makeScript(idea, document.querySelector("#genre").value, document.querySelector("#duration").value);
  renderScript(latestScript);
  result.classList.remove("hidden");
  result.scrollIntoView({behavior:"smooth",block:"start"});
});
document.querySelector("#copy-button").addEventListener("click", async () => {
  if (!latestScript) return;
  const button = document.querySelector("#copy-button");
  try {
    await navigator.clipboard.writeText(scriptAsText(latestScript));
    button.textContent = "Copiado ✓";
  } catch {
    button.textContent = "Não foi possível copiar";
  }
  setTimeout(() => button.textContent = "Copiar roteiro", 1800);
});
document.querySelector("#download-button").addEventListener("click", () => {
  if (!latestScript) return;
  const blob = new Blob([scriptAsText(latestScript)], {type:"text/plain;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "roteiro-estudio-2d.txt";
  link.click();
  URL.revokeObjectURL(url);
});