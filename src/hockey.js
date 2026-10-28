export const RINK = Object.freeze({ width: 100, height: 60, goalY: 30 });

export const ROLES = Object.freeze([
  "center",
  "leftWing",
  "rightWing",
  "leftDefense",
  "rightDefense",
  "goalie",
]);

export const ROLE_ACTIONS = Object.freeze({
  center: ["hold", "move", "pass", "shoot", "check", "forecheck", "faceoff"],
  leftWing: ["hold", "move", "pass", "shoot", "check", "forecheck"],
  rightWing: ["hold", "move", "pass", "shoot", "check", "forecheck"],
  leftDefense: ["hold", "move", "pass", "shoot", "check", "poke", "forecheck"],
  rightDefense: ["hold", "move", "pass", "shoot", "check", "poke", "forecheck"],
  goalie: ["guard", "move", "pass", "save", "cover"],
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const isDefense = (role) => role === "leftDefense" || role === "rightDefense";
const isForward = (role) => role === "center" || role === "leftWing" || role === "rightWing";
const MIN_PLAYER_DISTANCE = 4.2;

function makeTeam(id, attackDirection) {
  const positions = formationPositions(attackDirection);

  const players = ROLES.map((role) => {
    const [x, y] = positions[role];
    const playerId = `${id}-${role}`;
    return {
      id: playerId,
      teamId: id,
      role,
      x,
      y,
      skill: role === "goalie" ? 0.68 : 0.62,
    };
  });

  return {
    team: { id, attackDirection, score: 0, playerIds: players.map((player) => player.id) },
    players,
  };
}

function formationPositions(attackDirection) {
  const forwardX = 50 - attackDirection * 5;
  const defenseX = 50 - attackDirection * 12;
  return {
    center: [50 - attackDirection * 2.5, 30],
    leftWing: [forwardX, 22],
    rightWing: [forwardX, 38],
    leftDefense: [defenseX, 25],
    rightDefense: [defenseX, 35],
    goalie: [attackDirection === 1 ? 4 : 96, 30],
  };
}

function supportPosition(player, reference, attackDirection, defending) {
  const offsets = defending
    ? {
        center: [-4, 0], leftWing: [-9, -13], rightWing: [-9, 13],
        leftDefense: [-12, -6], rightDefense: [-12, 6],
      }
    : {
        center: [4, 0], leftWing: [8, -15], rightWing: [8, 15],
        leftDefense: [-15, -9], rightDefense: [-15, 9],
      };
  const [xOffset, yOffset] = offsets[player.role];
  return {
    type: "move",
    x: clamp(reference.x + attackDirection * xOffset, 6, 94),
    y: clamp(reference.y + yOffset, 6, 54),
  };
}

function nearestPlayer(state, playerIds, target) {
  return playerIds
    .map((id) => state.players[id])
    .filter((player) => player.role !== "goalie")
    .sort((a, b) => distance(a, target) - distance(b, target))[0];
}

function resetAfterGoal(state, scoringTeam) {
  for (const team of state.teams) {
    const positions = formationPositions(team.attackDirection);
    for (const id of team.playerIds) {
      const player = state.players[id];
      [player.x, player.y] = positions[player.role];
    }
  }

  state.faceoff = {
    centerIds: state.teams.map((team) => team.playerIds.find((id) => state.players[id].role === "center")),
  };
  state.puck.carrierId = null;
  state.puck.x = 50;
  state.puck.y = 30;
  state.puck.vx = 0;
  state.puck.vy = 0;
  recordEvent(state, "faceoff_started", { teamId: scoringTeam.id, x: 50, y: 30 });
}

export function createGame({ seed = 1, periodLength = 1200 } = {}) {
  if (!Number.isInteger(periodLength) || periodLength < 1) {
    throw new RangeError("periodLength must be a positive integer");
  }

  const home = makeTeam("home", 1);
  const away = makeTeam("away", -1);
  const players = Object.fromEntries([...home.players, ...away.players].map((player) => [player.id, player]));

  return {
    status: "running",
    tick: 0,
    periodLength,
    timeRemaining: periodLength,
    seed: seed >>> 0,
    teams: [home.team, away.team],
    players,
    faceoff: null,
    puck: { carrierId: "home-center", x: 50, y: 30, vx: 0, vy: 0 },
    events: [],
    eventLog: [],
  };
}

function teamFor(state, teamId) {
  return state.teams.find((team) => team.id === teamId);
}

function opponentTeam(state, teamId) {
  return state.teams.find((team) => team.id !== teamId);
}

function movePlayer(player, targetX, targetY, maxDistance = 4) {
  const dx = targetX - player.x;
  const dy = targetY - player.y;
  const length = Math.hypot(dx, dy);
  const scale = length > maxDistance ? maxDistance / length : 1;
  player.x = clamp(player.x + dx * scale, 0, RINK.width);
  player.y = clamp(player.y + dy * scale, 0, RINK.height);
}

export function enforcePlayerSpacing(players) {
  const skaters = Object.values(players);
  for (let iteration = 0; iteration < 24; iteration += 1) {
    let adjusted = false;
    for (let firstIndex = 0; firstIndex < skaters.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < skaters.length; secondIndex += 1) {
        const first = skaters[firstIndex];
        const second = skaters[secondIndex];
        const dx = first.x - second.x;
        const dy = first.y - second.y;
        const gap = Math.hypot(dx, dy);
        if (gap >= MIN_PLAYER_DISTANCE) continue;

        const angle = gap > 1e-9
          ? Math.atan2(dy, dx)
          : (firstIndex * skaters.length + secondIndex + 1) * 2.399963229728653;
        const directionX = gap > 1e-9 ? dx / gap : Math.cos(angle);
        const directionY = gap > 1e-9 ? dy / gap : Math.sin(angle);
        const overlap = MIN_PLAYER_DISTANCE - gap;
        let firstShare = first.role === "goalie" ? 0 : 0.5;
        let secondShare = second.role === "goalie" ? 0 : 0.5;
        if (firstShare + secondShare === 0) firstShare = secondShare = 0.5;
        const shareTotal = firstShare + secondShare;
        firstShare /= shareTotal;
        secondShare /= shareTotal;

        first.x = clamp(first.x + directionX * overlap * firstShare, 0, RINK.width);
        first.y = clamp(first.y + directionY * overlap * firstShare, 0, RINK.height);
        second.x = clamp(second.x - directionX * overlap * secondShare, 0, RINK.width);
        second.y = clamp(second.y - directionY * overlap * secondShare, 0, RINK.height);
        adjusted = true;
      }
    }
    if (!adjusted) break;
  }
  return players;
}

function bestPassingOption(state, player, team) {
  const direction = team.attackDirection;
  const options = team.playerIds
    .filter((id) => id !== player.id)
    .map((id) => state.players[id])
    .filter((teammate) => {
      const progress = (teammate.x - player.x) * direction;
      return progress > 4 && distance(player, teammate) < 34;
    })
    .sort((a, b) => (b.x - a.x) * direction - (a.x - player.x) * direction);

  for (const teammate of options) {
    const blocked = opponentTeam(state, player.teamId).playerIds
      .filter((id) => state.players[id].role !== "goalie")
      .some((id) => distanceToSegment(state.players[id], player, teammate) < 2.2);
    if (!blocked) return teammate;
  }
  return null;
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(point, start);
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}

export function decideAction(state, player) {
  const team = teamFor(state, player.teamId);
  const ownGoalX = team.attackDirection === 1 ? 4 : RINK.width - 4;

  if (state.faceoff?.centerIds.includes(player.id)) return { type: "faceoff" };

  if (player.role === "goalie") {
    if (state.puck.carrierId === player.id) {
      const outlet = team.playerIds
        .filter((id) => id !== player.id)
        .map((id) => state.players[id])
        .sort((a, b) => distance(player, a) - distance(player, b))[0];
      return outlet && distance(player, outlet) <= 38
        ? { type: "pass", targetId: outlet.id }
        : { type: "cover" };
    }
    if (!state.puck.carrierId && (state.puck.x - ownGoalX) * team.attackDirection < 14 && distance(player, state.puck) < 12) {
      return { type: "cover" };
    }
    const puckCarrier = state.puck.carrierId ? state.players[state.puck.carrierId] : null;
    const opponentHasPuck = puckCarrier && puckCarrier.teamId !== player.teamId;
    const y = clamp(opponentHasPuck ? puckCarrier.y : state.puck.y, 24, 36);
    if (opponentHasPuck && distance(player, puckCarrier) < 28) {
      return { type: "save", x: ownGoalX, y };
    }
    return distance(player, { x: ownGoalX, y }) > 0.8
      ? { type: "move", x: ownGoalX, y }
      : { type: "guard" };
  }

  const carrier = state.puck.carrierId ? state.players[state.puck.carrierId] : null;
  if (!carrier) {
    const chaser = nearestPlayer(state, team.playerIds, state.puck);
    if (chaser?.id === player.id) {
      return distance(player, state.puck) < 2 ? { type: "hold" } : { type: "move", x: state.puck.x, y: state.puck.y };
    }
    return supportPosition(player, state.puck, team.attackDirection, false);
  }

  if (carrier.id === player.id) {
    const goalX = team.attackDirection === 1 ? RINK.width : 0;
    const goalDistance = (goalX - player.x) * team.attackDirection;
    const passingOption = bestPassingOption(state, player, team);
    if (goalDistance < 30 && Math.abs(player.y - RINK.goalY) < 20) {
      return { type: "shoot" };
    }
    if (passingOption && goalDistance > 16) {
      return { type: "pass", targetId: passingOption.id };
    }
    return {
      type: "move",
      x: goalX - team.attackDirection * 8,
      y: clamp(player.y + (RINK.goalY - player.y) * 0.3, 10, 50),
    };
  }

  if (carrier.teamId !== player.teamId) {
    const gap = distance(player, carrier);
    const forwards = team.playerIds.filter((id) => isForward(state.players[id].role));
    const defenderIds = team.playerIds.filter((id) => isDefense(state.players[id].role));
    const primaryForechecker = nearestPlayer(state, forwards, carrier);
    const primaryDefender = nearestPlayer(state, defenderIds, carrier);

    if (player.id === primaryForechecker?.id) {
      if (gap < 3.5) return { type: "check", targetId: carrier.id };
      return { type: "forecheck", targetId: carrier.id };
    }

    if (player.id === primaryDefender?.id && gap < 4) {
      return { type: "poke", targetId: carrier.id };
    }
    if (isDefense(player.role) && player.id === primaryDefender?.id && gap < 20) {
      return { type: "move", x: carrier.x - team.attackDirection * 5, y: carrier.y };
    }
    return supportPosition(player, carrier, team.attackDirection, true);
  }

  return supportPosition(player, carrier, team.attackDirection, false);
}

function nextRandom(state) {
  state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0;
  return state.seed / 0x100000000;
}

function recordEvent(state, type, details = {}) {
  const event = { type, tick: state.tick, ...details };
  state.events.push(event);
  state.eventLog.push(event);
}

function isValidAction(action, player) {
  if (!action || !ROLE_ACTIONS[player.role].includes(action.type)) return false;
  if (["move", "save"].includes(action.type)) {
    return Number.isFinite(action.x) && Number.isFinite(action.y);
  }
  return true;
}

function actOnPuck(state, player, action) {
  const team = teamFor(state, player.teamId);
  if (action.type === "move") {
    movePlayer(player, action.x, action.y);
    state.puck.x = player.x;
    state.puck.y = player.y;
    return;
  }

  if (action.type === "pass") {
    const target = state.players[action.targetId];
    if (!target || target.teamId !== player.teamId || target.id === player.id || distance(player, target) > 38) {
      recordEvent(state, "pass_failed", { playerId: player.id });
      return;
    }
    const intercepted = opponentTeam(state, player.teamId).playerIds
      .filter((id) => state.players[id].role !== "goalie")
      .some((id) => distanceToSegment(state.players[id], player, target) < 1.4 && nextRandom(state) < 0.48);
    if (intercepted) {
      state.puck.carrierId = null;
      state.puck.x = (player.x + target.x) / 2;
      state.puck.y = (player.y + target.y) / 2;
      recordEvent(state, "pass_intercepted", { playerId: player.id });
    } else {
      state.puck.carrierId = target.id;
      state.puck.x = target.x;
      state.puck.y = target.y;
      recordEvent(state, "pass_completed", { playerId: player.id, targetId: target.id });
    }
    return;
  }

  if (action.type === "shoot") {
    const goalX = team.attackDirection === 1 ? RINK.width : 0;
    const goalDistance = Math.abs(goalX - player.x);
    const targetY = clamp(RINK.goalY + (nextRandom(state) - 0.5) * 8, 24, 36);
    const goalie = state.players[opponentTeam(state, player.teamId).playerIds.find((id) => state.players[id].role === "goalie")];
    const quality = clamp(1 - goalDistance / 82, 0, 1);
    const scoringChance = 0.12 + quality * 0.58 + player.skill * 0.1;
    const saveChance = 0.12 + Math.max(0, 1 - Math.abs(goalie.y - targetY) / 18) * 0.43 + goalie.skill * 0.12;

    if (nextRandom(state) < scoringChance && nextRandom(state) > saveChance) {
      team.score += 1;
      recordEvent(state, "goal", { teamId: team.id, playerId: player.id, score: team.score });
      resetAfterGoal(state, team);
    } else if (nextRandom(state) < saveChance) {
      state.puck.carrierId = goalie.id;
      state.puck.x = goalie.x;
      state.puck.y = goalie.y;
      recordEvent(state, "save", { goalieId: goalie.id, shooterId: player.id });
    } else {
      state.puck.carrierId = null;
      state.puck.x = goalX - team.attackDirection * 2;
      state.puck.y = targetY;
      state.puck.vx = -team.attackDirection * 1.4;
      state.puck.vy = (nextRandom(state) - 0.5) * 1.4;
      recordEvent(state, "shot_missed", { playerId: player.id });
    }
    return;
  }

  if (action.type === "check" || action.type === "poke") {
    const target = state.players[action.targetId];
    if (target?.id === state.puck.carrierId && distance(player, target) < 3.5) {
      const chance = action.type === "poke" ? 0.42 : 0.32;
      if (nextRandom(state) < chance + player.skill * 0.2) {
        state.puck.carrierId = null;
        state.puck.x = target.x;
        state.puck.y = target.y;
        state.puck.vx = team.attackDirection * 0.5;
        recordEvent(state, "puck_stolen", { playerId: player.id, targetId: target.id });
      }
    }
  }
}

export function stepGame(state, { agents = {} } = {}) {
  if (state.status !== "running") return state;
  state.events = [];
  const isFaceoffStep = Boolean(state.faceoff);

  const snapshot = structuredClone(state);
  const actions = {};
  for (const player of Object.values(snapshot.players)) {
    const agent = agents[player.id] ?? agents[player.role];
    const action = agent ? agent(snapshot, player) : decideAction(snapshot, player);
    actions[player.id] = isValidAction(action, player) ? action : { type: "hold" };
  }

  for (const player of Object.values(state.players)) {
    const action = actions[player.id];
    if (player.id === state.puck.carrierId) continue;
    if (action.type === "move" || action.type === "save") {
      movePlayer(player, action.x, action.y, player.role === "goalie" ? 2.8 : 4);
    } else if (action.type === "forecheck") {
      const target = state.players[action.targetId];
      if (target) movePlayer(player, target.x, target.y, 4.2);
    } else if (action.type === "cover" && player.role === "goalie" && !state.puck.carrierId) {
      movePlayer(player, state.puck.x, state.puck.y, 3);
    }
  }

  const carrier = state.puck.carrierId ? state.players[state.puck.carrierId] : null;
  if (carrier) {
    actOnPuck(state, carrier, actions[carrier.id]);
  } else if (isFaceoffStep) {
    state.puck.x = 50;
    state.puck.y = 30;
    state.puck.vx = 0;
    state.puck.vy = 0;
  } else {
    state.puck.x = clamp(state.puck.x + state.puck.vx, 0, RINK.width);
    state.puck.y = clamp(state.puck.y + state.puck.vy, 0, RINK.height);
    state.puck.vx *= 0.82;
    state.puck.vy *= 0.82;
    const nearest = Object.values(state.players)
      .filter((player) => player.role !== "goalie" || actions[player.id].type === "cover")
      .map((player) => ({ player, gap: distance(player, state.puck) }))
      .filter(({ gap }) => gap < 1.8)
      .sort((a, b) => a.gap - b.gap)[0];
    if (nearest) {
      state.puck.carrierId = nearest.player.id;
      state.puck.vx = 0;
      state.puck.vy = 0;
      recordEvent(state, "puck_recovered", { playerId: nearest.player.id });
    }
  }

  for (const player of Object.values(state.players)) {
    if (player.teamId === carrier?.teamId || player.role === "goalie") continue;
    const action = actions[player.id];
    if ((action.type === "check" || action.type === "poke") && state.puck.carrierId === carrier?.id) {
      actOnPuck(state, player, action);
    }
  }

  enforcePlayerSpacing(state.players);
  if (isFaceoffStep) {
    const [firstCenterId, secondCenterId] = state.faceoff.centerIds;
    const centers = [state.players[firstCenterId], state.players[secondCenterId]];
    const winner = centers[nextRandom(state) < 0.5 ? 0 : 1];
    state.puck.carrierId = winner.id;
    state.faceoff = null;
    recordEvent(state, "faceoff_won", { teamId: winner.teamId, playerId: winner.id });
  }


  if (state.puck.carrierId) {
    const currentCarrier = state.players[state.puck.carrierId];
    state.puck.x = currentCarrier.x;
    state.puck.y = currentCarrier.y;
  }

  state.tick += 1;
  state.timeRemaining = Math.max(0, state.periodLength - state.tick);
  if (state.timeRemaining === 0) {
    state.status = "finished";
    recordEvent(state, "period_ended");
  }
  return state;
}

export function simulateGame(state, options = {}) {
  while (state.status === "running") stepGame(state, options);
  return state;
}