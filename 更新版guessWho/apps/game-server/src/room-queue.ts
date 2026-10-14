import { logPerformance } from "./diagnostics.js";

/** Serializes commits and broadcasts per room; failures never poison the tail. */
export function createRoomQueue() {
  const tails = new Map<string, Promise<void>>();
  return {
    run<T>(roomId: string, event: string, work: () => Promise<T>): Promise<T> {
      const queuedAt = performance.now();
      const result = (tails.get(roomId) ?? Promise.resolve()).then(() => {
        logPerformance(event, { queueMs: performance.now() - queuedAt });
        return work();
      });
      const tail = result.then(() => undefined, () => undefined);
      tails.set(roomId, tail);
      void tail.then(() => { if (tails.get(roomId) === tail) tails.delete(roomId); });
      return result;
    },
    async drain() { await Promise.all(tails.values()); },
    get size() { return tails.size; },
  };
}
