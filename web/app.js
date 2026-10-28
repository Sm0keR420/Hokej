import { createGame, enforcePlayerSpacing, stepGame } from "/hockey.js";

const svgNamespace = "http://www.w3.org/2000/svg";
const rink = document.querySelector("#rink");
const playerLayer = document.querySelector("#playerLayer");
const puckLayer = document.querySelector("#puckLayer");
const actionLayer = document.querySelector("#actionLayer");
const playerNodes = new Map();
const playerLabels = {
  center: "Střední útočník",
  leftWing: "Levé křídlo",
  rightWing: "Pravé křídlo",
  leftDefense: "Levý obránce",
  rightDefense: "Pravý obránce",
  goalie: "Brankář",
};
const jerseyNumbers = { center: 9, leftWing: 11, rightWing: 21, leftDefense: 4, rightDefense: 5, goalie: 1 };
const teamNames = { home: "Sever", away: "Havraní" };
const gameElements = {
  homeScore: document.querySelector("#homeScore"),
  awayScore: document.querySelector("#awayScore"),
  clock: document.querySelector("#gameClock"),
  matchState: document.querySelector("#matchState"),
  possession: document.querySelector("#possessionText"),
  homeCarrier: document.querySelector("#homeCarrier"),
  awayCarrier: document.querySelector("#awayCarrier"),
  feed: document.querySelector("#eventFeed"),
  eventCount: document.querySelector("#eventCount"),
};

let game = createGame({ seed: 2026, periodLength: 1200 });
let playing = true;
let speed = 1;
let intervalId;
let eventCount = 0;
let motion = { startedAt: performance.now(), duration: 850, fromPlayers: {}, toPlayers: {}, fromPuck: { x: 50, y: 30 }, events: [] };
let renderedPositions = {};
let renderedPuckPosition = { x: 47.5, y: 30 };

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(svgNamespace, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function rinkX(x) { return 22 + x * 9.56; }
function rinkY(y) { return 22 + y * (556 / 60); }

function addPlayer(player) {
  const group = svgElement("g", { class: `player player-${player.teamId}${player.role === "goalie" ? " player-goalie" : ""}` });
  const title = svgElement("title");
  title.textContent = `${teamNames[player.teamId]} · ${playerLabels[player.role]}`;
  group.append(
    title,
    svgElement("circle", { class: "player-halo", r: 23 }),
    svgElement("circle", { class: "player-shadow", cx: 2, cy: 4, r: 20 }),
    svgElement("circle", { class: "player-ring", r: 19 }),
    svgElement("circle", { class: "player-jersey", r: 16 }),
  );
  const number = svgElement("text", { class: "player-number", y: 1 });
  number.textContent = jerseyNumbers[player.role];
  group.append(number);
  playerLayer.append(group);
  playerNodes.set(player.id, group);
}

function addPuck() {
  puckLayer.append(
    svgElement("ellipse", { class: "puck-shadow", cx: 2, cy: 3, rx: 9, ry: 5 }),
    svgElement("ellipse", { class: "puck", rx: 8, ry: 5 }),
  );
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function describeEvent(event) {
  const actor = event.playerId ? game.players[event.playerId] : null;
  const actorName = actor ? `${teamNames[actor.teamId]} · ${playerLabels[actor.role].toLowerCase()}` : "";
  switch (event.type) {
    case "goal": return { text: `Gól! ${teamNames[event.teamId]} skórují`, goal: true };
    case "pass_completed": return { text: `${actorName} nahrává spoluhráči` };
    case "pass_intercepted": return { text: `${actorName} — přihrávka zachycena` };
    case "pass_failed": return { text: `${actorName} — nepřesná přihrávka` };
    case "save": return { text: "Brankář vyráží střelu" };
    case "shot_missed": return { text: `${actorName} střílí mimo branku` };
    case "puck_stolen": return { text: `${actorName} získává puk` };
    case "puck_recovered": return { text: `${actorName} sbírá volný puk` };
    case "faceoff_started": return { text: "Vhazování na středové čáře" };
    case "faceoff_won": return { text: `Vhazování vyhráli ${teamNames[event.teamId]}` };
    case "period_ended": return { text: "Konec třetiny" };
    default: return null;
  }
}

function addFeedEvent(event) {
  const description = describeEvent(event);
  if (!description) return;
  const item = document.createElement("li");
  if (description.goal) item.classList.add("is-goal");
  const time = document.createElement("time");
  time.textContent = formatTime(Math.max(0, game.periodLength - event.tick));
  const text = document.createElement("span");
  text.textContent = description.text;
  item.append(time, text);
  gameElements.feed.querySelector(".feed-empty")?.remove();
  gameElements.feed.prepend(item);
  while (gameElements.feed.children.length > 12) gameElements.feed.lastElementChild.remove();
  eventCount += 1;
  gameElements.eventCount.textContent = eventCount;
}

function updateScoreboard() {
  const [home, away] = game.teams;
  gameElements.homeScore.textContent = home.score;
  gameElements.awayScore.textContent = away.score;
  gameElements.clock.textContent = formatTime(game.timeRemaining);
  gameElements.matchState.textContent = game.status === "running" ? "ZÁPAS PROBÍHÁ" : "KONEC ZÁPASU";
  document.querySelector("#playToggle").title = playing ? "Pozastavit simulaci" : "Spustit simulaci";
  document.querySelector("#playToggle").setAttribute("aria-label", playing ? "Pozastavit simulaci" : "Spustit simulaci");
  document.querySelector("#playIcon").textContent = playing ? "Ⅱ" : "▶";

  const carrier = game.puck.carrierId ? game.players[game.puck.carrierId] : null;
  if (game.faceoff) {
    gameElements.possession.textContent = "Vhazování na středové čáře";
    gameElements.homeCarrier.textContent = "Na vhazování";
    gameElements.awayCarrier.textContent = "Na vhazování";
    return;
  }
  if (!carrier) {
    gameElements.possession.textContent = "Volný puk";
    gameElements.homeCarrier.textContent = "Bez puku";
    gameElements.awayCarrier.textContent = "Bez puku";
    return;
  }
  const role = playerLabels[carrier.role];
  gameElements.possession.textContent = `${teamNames[carrier.teamId]} · ${role.toLowerCase()} má puk`;
  gameElements.homeCarrier.textContent = carrier.teamId === "home" ? `${role} má puk` : "Bez puku";
  gameElements.awayCarrier.textContent = carrier.teamId === "away" ? `${role} má puk` : "Bez puku";
}

function drawAction(event, fromPuck) {
  const shooter = event.playerId ? game.players[event.playerId] : null;
  const target = event.targetId ? game.players[event.targetId] : null;
  let start;
  let end;
  let type;
  if (event.type === "pass_completed" && shooter && target) {
    start = { x: shooter.x, y: shooter.y };
    end = { x: target.x, y: target.y };
    type = "pass";
  } else if (["goal", "save", "shot_missed"].includes(event.type) && shooter) {
    const direction = game.teams.find((team) => team.id === shooter.teamId).attackDirection;
    start = { x: shooter.x, y: shooter.y };
    end = { x: direction === 1 ? 98 : 2, y: 30 };
    type = "shot";
  }
  if (!start || !end) return;

  const line = svgElement("line", {
    class: `action-line action-${type}`,
    x1: rinkX(start.x), y1: rinkY(start.y), x2: rinkX(end.x), y2: rinkY(end.y),
    "marker-end": "url(#arrow)",
  });
  actionLayer.append(line);
  window.setTimeout(() => line.remove(), 900);
  if (type === "pass") motion.puckTargetId = target.id;
  else motion.puckTarget = end;
  motion.fromPuck = fromPuck;
}

function advanceGame() {
  if (game.status !== "running") {
    setPlaying(false);
    return;
  }

  const before = structuredClone(game);
  stepGame(game);
  motion = {
    startedAt: performance.now(),
    duration: 1000 / speed,
    fromPlayers: Object.keys(renderedPositions).length === Object.keys(before.players).length
      ? structuredClone(renderedPositions)
      : before.players,
    toPlayers: game.players,
    fromPuck: structuredClone(renderedPuckPosition),
    events: game.events,
  };
  for (const event of game.events) {
    drawAction(event, motion.fromPuck);
    addFeedEvent(event);
  }
  updateScoreboard();
  if (game.status !== "running") setPlaying(false);
}

function renderFrame(now) {
  const progress = Math.min(1, (now - motion.startedAt) / motion.duration);
  const eased = progress;
  renderedPositions = {};

  for (const [id, player] of Object.entries(game.players)) {
    const from = motion.fromPlayers[id] ?? player;
    const to = motion.toPlayers[id] ?? player;
    const x = from.x + (to.x - from.x) * eased;
    const y = from.y + (to.y - from.y) * eased;
    renderedPositions[id] = { x, y };
  }

  enforcePlayerSpacing(renderedPositions);
  for (const [id, position] of Object.entries(renderedPositions)) {
    const player = game.players[id];
    playerNodes.get(id)?.setAttribute("transform", `translate(${rinkX(position.x)} ${rinkY(position.y)})`);
    playerNodes.get(id)?.classList.toggle("is-carrier", id === game.puck.carrierId);
  }

  let puckPosition;
  if (motion.puckTargetId && motion.fromPuck) {
    const target = renderedPositions[motion.puckTargetId] ?? game.players[motion.puckTargetId];
    puckPosition = {
      x: motion.fromPuck.x + (target.x - motion.fromPuck.x) * eased,
      y: motion.fromPuck.y + (target.y - motion.fromPuck.y) * eased,
    };
    if (progress === 1) motion.puckTargetId = null;
  } else if (motion.puckTarget && motion.fromPuck) {
    puckPosition = {
      x: motion.fromPuck.x + (motion.puckTarget.x - motion.fromPuck.x) * eased,
      y: motion.fromPuck.y + (motion.puckTarget.y - motion.fromPuck.y) * eased,
    };
    if (progress === 1) motion.puckTarget = null;
  } else if (game.puck.carrierId && renderedPositions[game.puck.carrierId]) {
    puckPosition = renderedPositions[game.puck.carrierId];
  } else {
    const from = motion.fromPuck;
    puckPosition = { x: from.x + (game.puck.x - from.x) * eased, y: from.y + (game.puck.y - from.y) * eased };
  }

  renderedPuckPosition = puckPosition;
  puckLayer.setAttribute("transform", `translate(${rinkX(puckPosition.x)} ${rinkY(puckPosition.y)})`);
  window.requestAnimationFrame(renderFrame);
}

function setPlaying(nextPlaying) {
  playing = nextPlaying && game.status === "running";
  window.clearInterval(intervalId);
  if (playing) intervalId = window.setInterval(advanceGame, 1000 / speed);
  updateScoreboard();
}

function resetGame() {
  setPlaying(false);
  game = createGame({ seed: 2026, periodLength: 1200 });
  eventCount = 0;
  playerLayer.replaceChildren();
  actionLayer.replaceChildren();
  gameElements.feed.replaceChildren();
  const empty = document.createElement("li");
  empty.className = "feed-empty";
  empty.textContent = "Zápas začíná. Čekáme na první akci.";
  gameElements.feed.append(empty);
  gameElements.eventCount.textContent = "0";
  for (const player of Object.values(game.players)) addPlayer(player);
  motion = {
    startedAt: performance.now(), duration: 500,
    fromPlayers: structuredClone(game.players), toPlayers: game.players,
    fromPuck: { x: game.puck.x, y: game.puck.y }, events: [],
  };
  renderedPuckPosition = { x: game.puck.x, y: game.puck.y };
  puckLayer.setAttribute("transform", `translate(${rinkX(game.puck.x)} ${rinkY(game.puck.y)})`);
  updateScoreboard();
  setPlaying(true);
}

document.querySelector("#playToggle").addEventListener("click", () => setPlaying(!playing));
document.querySelector("#stepButton").addEventListener("click", () => {
  if (playing) setPlaying(false);
  advanceGame();
});
document.querySelector("#resetButton").addEventListener("click", resetGame);
document.querySelector("#speedSelect").addEventListener("change", (event) => {
  speed = Number(event.target.value);
  if (playing) setPlaying(true);
});

for (const player of Object.values(game.players)) addPlayer(player);
addPuck();
updateScoreboard();
setPlaying(true);
window.requestAnimationFrame(renderFrame);