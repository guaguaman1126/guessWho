export function logPerformance(event: string, metrics: object): void {
  if (process.env.GAME_PERF_LOG === "true") console.log(JSON.stringify({ kind: "game-perf", event, ...metrics }));
}
