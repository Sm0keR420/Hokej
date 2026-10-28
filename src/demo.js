import { createGame, simulateGame } from "./hockey.js";

const game = simulateGame(createGame({ seed: 2026, periodLength: 180 }));
for (const event of game.eventLog) {
  if (event.type === "goal") console.log(`GOAL ${event.teamId}: ${event.score}`);
}

console.log(`Final score: home ${game.teams[0].score} - ${game.teams[1].score} away`);
console.log(`Simulated ${game.tick} seconds; puck possession: ${game.puck.carrierId ?? "loose"}`);