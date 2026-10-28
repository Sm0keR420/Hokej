import test from "node:test";
import assert from "node:assert/strict";
import { createGame, decideAction, ROLE_ACTIONS, simulateGame, stepGame } from "../src/hockey.js";

test("starts with two complete 5+1 lineups", () => {
  const game = createGame();
  assert.equal(Object.keys(game.players).length, 12);
  for (const team of game.teams) {
    assert.equal(team.playerIds.length, 6);
    assert.deepEqual(team.playerIds.map((id) => game.players[id].role).sort(), Object.keys(ROLE_ACTIONS).sort());
  }
});

test("rule-based agents choose actions allowed by each role", () => {
  const game = createGame();
  for (const player of Object.values(game.players)) {
    const action = decideAction(game, player);
    assert.ok(ROLE_ACTIONS[player.role].includes(action.type));
  }
});

test("only one forward forechecks while teammates hold their lanes", () => {
  const game = createGame();
  game.players["away-center"].x = 65;
  game.puck.carrierId = "away-center";
  game.puck.x = 65;
  const homeActions = game.teams[0].playerIds.map((id) => ({ id, action: decideAction(game, game.players[id]) }));
  const forecheckers = homeActions.filter(({ action }) => action.type === "forecheck");
  const leftWing = homeActions.find(({ id }) => id === "home-leftWing").action;
  const rightWing = homeActions.find(({ id }) => id === "home-rightWing").action;

  assert.equal(forecheckers.length, 1);
  assert.equal(forecheckers[0].id, "home-center");
  assert.ok(Math.abs(leftWing.y - rightWing.y) >= 20);
});

test("players support a loose puck without collapsing into a group", () => {
  const game = createGame();
  game.puck.carrierId = null;
  game.puck.x = 60;
  game.puck.y = 30;
  const actions = game.teams[0].playerIds.map((id) => decideAction(game, game.players[id]));
  const chasers = actions.filter((action) => action.x === game.puck.x && action.y === game.puck.y);

  assert.equal(chasers.length, 1);
});

test("a nearby forechecker can take the puck from the carrier", () => {
  const game = createGame({ seed: 1 });
  game.players["away-center"].x = 52;
  game.puck.carrierId = "away-center";
  game.puck.x = 52;

  stepGame(game);

  assert.notEqual(game.puck.carrierId, "away-center");
  assert.ok(game.events.some((event) => event.type === "puck_stolen"));
});

test("custom agents can complete a pass", () => {
  const game = createGame({ periodLength: 3 });
  const targetId = "home-leftWing";
  game.players[targetId].x = 65;
  game.players[targetId].y = 16;
  for (const id of game.teams[1].playerIds) {
    if (game.players[id].role !== "goalie") {
      game.players[id].x = 88;
      game.players[id].y = 55;
    }
  }
  const agents = Object.fromEntries(Object.keys(game.players).map((id) => [id, () => ({ type: "hold" })]));
  agents["home-center"] = () => ({ type: "pass", targetId });

  stepGame(game, { agents });

  assert.equal(game.puck.carrierId, targetId);
  assert.ok(game.events.some((event) => event.type === "pass_completed"));
});

test("a goal resets both teams and gives the puck to the scoring team", () => {
  const game = createGame({ seed: 1, periodLength: 10 });
  const startPositions = Object.fromEntries(
    Object.entries(game.players).map(([id, player]) => [id, { x: player.x, y: player.y }]),
  );
  game.players["home-center"].x = 80;
  game.players["away-goalie"].y = 0;
  game.puck.carrierId = "home-center";
  game.puck.x = 80;
  const agents = Object.fromEntries(Object.keys(game.players).map((id) => [id, () => ({ type: "hold" })]));
  agents["home-center"] = () => ({ type: "shoot" });

  stepGame(game, { agents });

  assert.ok(game.events.some((event) => event.type === "goal" && event.teamId === "home"));
  assert.equal(game.puck.carrierId, "home-center");
  assert.deepEqual(
    Object.fromEntries(Object.entries(game.players).map(([id, player]) => [id, { x: player.x, y: player.y }])),
    startPositions,
  );
});

test("goalie passes the puck after a save", () => {
  const game = createGame({ periodLength: 3 });
  const goalie = game.players["home-goalie"];
  game.puck.carrierId = goalie.id;
  game.puck.x = goalie.x;
  game.puck.y = goalie.y;
  const agents = Object.fromEntries(
    Object.keys(game.players).filter((id) => id !== goalie.id).map((id) => [id, () => ({ type: "hold" })]),
  );

  stepGame(game, { agents });

  assert.notEqual(game.puck.carrierId, goalie.id);
  assert.ok(game.events.some((event) => event.type === "pass_completed"));
});

test("simulation is deterministic and ends when time expires", () => {
  const first = simulateGame(createGame({ seed: 91, periodLength: 80 }));
  const second = simulateGame(createGame({ seed: 91, periodLength: 80 }));
  assert.equal(first.status, "finished");
  assert.equal(first.tick, 80);
  assert.deepEqual(first.teams.map((team) => team.score), second.teams.map((team) => team.score));
  assert.deepEqual(first.events, second.events);
  assert.deepEqual(first.eventLog, second.eventLog);
  assert.equal(first.eventLog.filter((event) => event.type === "goal").length,
    first.teams.reduce((total, team) => total + team.score, 0));
  for (const player of Object.values(first.players)) {
    assert.ok(player.x >= 0 && player.x <= 100);
    assert.ok(player.y >= 0 && player.y <= 60);
  }
});

test("finished games do not advance", () => {
  const game = simulateGame(createGame({ periodLength: 1 }));
  stepGame(game);
  assert.equal(game.tick, 1);
  assert.equal(game.status, "finished");
});