import type { Card } from "@guesswho/shared/game-types";

/** One resolver per room effect; never persist download URLs across room visits. */
export function createRoomImageResolver(download: (path: string) => Promise<string>) {
  const cache = new Map<string, Promise<string>>();
  let sequence = 0;
  let active = true;

  function image(path: string): Promise<string> {
    if (!path) return Promise.resolve("");
    const cached = cache.get(path);
    if (cached) return cached;
    const pending = Promise.resolve().then(() => download(path)).catch(error => {
      if (cache.get(path) === pending) cache.delete(path);
      throw error;
    });
    cache.set(path, pending);
    return pending;
  }

  return {
    async resolve<T extends { cards: Card[] }>(next: T): Promise<T | null> {
      if (!active) return null;
      const received = ++sequence;
      const paths = new Set(next.cards.map(card => card.imagePath));
      for (const path of cache.keys()) if (!paths.has(path)) cache.delete(path);
      const cards = await Promise.all(next.cards.map(async card => ({
        ...card, imagePath: await image(card.imagePath).catch(() => ""),
      })));
      return active && received === sequence ? { ...next, cards } : null;
    },
    dispose() { active = false; sequence++; cache.clear(); },
  };
}
