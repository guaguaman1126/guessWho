import assert from "node:assert/strict";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { createRoomStore, type StoreMetrics } from "./room-store.js";
import { applyCommand, createRoom, joinRoom } from "./game-rules.js";

// Small transactional double: records actual requested paths and applies writes only on commit.
function database() {
  const data = new Map<string, object>();
  const reads: string[] = [];
  const writes: string[] = [];
  let failCommit = false;
  let retry: (() => void) | undefined;
  const doc = (path: string): any => ({ path, firestore: db, collection: (name: string) => collection(`${path}/${name}`) });
  const collection = (path: string): any => ({ path, query: true, doc: (id: string) => doc(`${path}/${id}`) });
  const snapshot = (path: string) => ({ id: path.split("/").at(-1)!, exists: data.has(path), data: () => structuredClone(data.get(path)) });
  const db = {
    doc,
    async runTransaction(work: (tx: any) => Promise<any>): Promise<any> {
      const run = async () => {
        const pending = new Map<string, object | undefined>();
        const tx = {
          async get(ref: any) {
            reads.push(ref.path);
            if (!ref.query) return snapshot(ref.path);
            const docs = [...data.keys()].filter(path => path.startsWith(ref.path + "/") && path.split("/").length === ref.path.split("/").length + 1).map(snapshot);
            return { docs, size: docs.length };
          },
          getAll: (...refs: any[]) => Promise.all(refs.map(ref => tx.get(ref))),
          set(ref: any, value: object) { writes.push(ref.path); pending.set(ref.path, structuredClone(value)); },
          delete(ref: any) { writes.push(ref.path); pending.set(ref.path, undefined); },
        };
        return { result: await work(tx), pending };
      };
      let attempt = await run();
      if (retry) { const change = retry; retry = undefined; change(); attempt = await run(); }
      if (failCommit) { failCommit = false; throw new Error("commit failed"); }
      for (const [path, value] of attempt.pending) if (value === undefined) data.delete(path); else data.set(path, value);
      return attempt.result;
    },
  };
  return { db: db as unknown as Firestore, data, reads, writes,
    reset() { reads.length = 0; writes.length = 0; },
    failNextCommit() { failCommit = true; },
    retryNext(change: () => void) { retry = change; },
  };
}

async function fixture() {
  const fake = database();
  const metrics: StoreMetrics[] = [];
  const store = createRoomStore(fake.db, (_event, row) => metrics.push(row));
  const state = createRoom("ABC123", "host", 9, "retain", "secret", 1);
  joinRoom(state, "guest", "secret", 2);
  state.cards.forEach(card => { card.name = `card ${card.id}`; card.imagePath = `rooms/ABC123/cards/${card.id}/a.jpg`; });
  state.targets = { host: 1, guest: 3 };
  state.room.status = "playing";
  state.room.currentTurnUid = "host";
  await store.createAggregate(state);
  fake.reset();
  return { fake, store, metrics };
}

test("warm fold reads five dynamic documents, writes two, and never touches cards/password", async () => {
  const { fake, store, metrics } = await fixture();
  await store.updateAggregate("ABC123", state => applyCommand(state, "host", { type: "card:fold-toggle", payload: { cardId: 2 } }, 10), { gameplay: true });
  assert.deepEqual(fake.reads.sort(), ["rooms/ABC123", "rooms/ABC123/players/host", "rooms/ABC123/players/guest", "rooms/ABC123/targets/host", "rooms/ABC123/targets/guest"].sort());
  assert.deepEqual(fake.writes.sort(), ["rooms/ABC123", "rooms/ABC123/players/host"].sort());
  assert.deepEqual(fake.data.get("rooms/ABC123/secrets/access"), { password: "secret" });
  assert.equal(metrics.at(-1)?.readDocuments, 5);
  assert.equal(metrics.at(-1)?.writeDocuments, 2);
  fake.reset();
  await store.updateAggregate("ABC123", state => applyCommand(state, "host", { type: "game:guess", payload: { cardId: 2 } }, 11), { gameplay: true });
  assert.deepEqual(fake.writes, ["rooms/ABC123"]);
});

test("cache miss/version change/legacy rooms reload cards, while no-op edits keep the version", async () => {
  const { fake, store } = await fixture();
  const room = fake.data.get("rooms/ABC123") as any;
  delete room.deckVersion;
  store.clearDecks();
  await store.updateAggregate("ABC123", () => undefined, { gameplay: true });
  assert(fake.reads.includes("rooms/ABC123/cards"));
  fake.reset();
  const changed = await store.updateAggregate("ABC123", state => { state.cards[0].name = "new"; });
  assert.equal(changed.state.room.deckVersion, 1);
  assert.equal((await store.updateAggregate("ABC123", () => undefined)).state.room.deckVersion, 1);
  // Simulate another valid writer atomically changing the deck and its version.
  (fake.data.get("rooms/ABC123") as any).deckVersion = 2;
  fake.data.set("rooms/ABC123/cards/1", { name: "external", imagePath: "new.jpg" });
  fake.reset();
  const result = await store.updateAggregate("ABC123", () => undefined, { gameplay: true });
  assert.equal(result.state.cards[0].name, "external");
  assert(fake.reads.includes("rooms/ABC123/cards"));
});

test("failed commits and retried callbacks cannot publish speculative cache contents", async () => {
  const { fake, store, metrics } = await fixture();
  fake.failNextCommit();
  await assert.rejects(store.updateAggregate("ABC123", state => { state.cards[0].name = "uncommitted"; }), /commit failed/);
  const afterFailure = await store.updateAggregate("ABC123", () => undefined, { gameplay: true });
  assert.equal(afterFailure.state.cards[0].name, "card 1");
  store.clearDecks();
  fake.retryNext(() => {
    (fake.data.get("rooms/ABC123") as any).deckVersion = 1;
    fake.data.set("rooms/ABC123/cards/1", { name: "retried", imagePath: "new.jpg" });
  });
  const retried = await store.updateAggregate("ABC123", () => undefined, { gameplay: true });
  assert.equal(retried.state.cards[0].name, "retried");
  assert.equal(metrics.at(-1)?.attempts, 2);
  assert.equal((await store.updateAggregate("ABC123", () => undefined, { gameplay: true })).state.cards[0].name, "retried");
});

test("winning removes targets and resets both players atomically; deletion evicts the deck", async () => {
  const { fake, store } = await fixture();
  await store.updateAggregate("ABC123", state => applyCommand(state, "host", { type: "card:fold-toggle", payload: { cardId: 2 } }, 10), { gameplay: true });
  const result = await store.updateAggregate("ABC123", state => applyCommand(state, "host", { type: "game:guess", payload: { cardId: 3 } }, 11), { gameplay: true });
  assert.equal(result.state.room.status, "lobby");
  assert.deepEqual(result.state.targets, {});
  assert(result.state.players.every(player => player.foldedCardIds.length === 0 && !player.ready));
  assert(!fake.data.has("rooms/ABC123/targets/host"));
  await store.updateAggregate("ABC123", () => ({ deleteRoom: true }));
  assert.equal(fake.data.size, 0);
  assert.equal(store.cachedDecks, 0);
});
