import { isDeepStrictEqual } from "node:util";
import type { Firestore, Transaction, DocumentReference } from "firebase-admin/firestore";
import type { Card } from "@guesswho/shared/game-types";
import type { RoomAggregate, RoomRecord, PlayerRecord } from "./game-rules.js";
import { logPerformance } from "./diagnostics.js";

export type StoreMetrics = {
  attempts: number; retries: number; readDocuments: number; writeDocuments: number;
  cardReads: number; secretReads: number; cacheHit: boolean;
  loadMs: number; ruleMs: number; transactionMs: number; ok: boolean;
};
type Options = { gameplay?: boolean; event?: string };

/** Instance-owned, disposable card cache. Dynamic/secret game state is always read in a transaction. */
export function createRoomStore(db: Firestore, report: (event: string, metrics: StoreMetrics) => void = logPerformance) {
  const decks = new Map<string, { version: number; cards: Card[] }>();

  function remember(state: RoomAggregate) {
    decks.set(state.roomId, { version: state.room.deckVersion, cards: structuredClone(state.cards) });
  }

  async function updateAggregate<T>(roomId: string, mutate: (state: RoomAggregate) => T, options: Options = {}): Promise<{ value: T; state: RoomAggregate }> {
    const metrics: StoreMetrics = { attempts: 0, retries: 0, readDocuments: 0, writeDocuments: 0, cardReads: 0, secretReads: 0, cacheHit: false, loadMs: 0, ruleMs: 0, transactionMs: 0, ok: false };
    const start = performance.now();
    try {
      const result = await db.runTransaction(async transaction => {
        metrics.attempts++;
        const roomRef = db.doc(`rooms/${roomId}`);
        const loadStart = performance.now();
        const state = await load(transaction, roomRef, roomId, Boolean(options.gameplay), metrics);
        const before = documents(state, !options.gameplay);
        const oldCards = structuredClone(state.cards);
        const oldCount = state.room.cardCount;
        metrics.loadMs += performance.now() - loadStart;
        const ruleStart = performance.now();
        const value = mutate(state);
        metrics.ruleMs += performance.now() - ruleStart;
        if (!isDeepStrictEqual(oldCards, state.cards) || oldCount !== state.room.cardCount) {
          if (options.gameplay) throw new Error("遊戲操作不可修改卡組");
          state.room.deckVersion++;
        }
        const deleting = Boolean((value as { deleteRoom?: boolean } | undefined)?.deleteRoom);
        if (deleting && options.gameplay) throw new Error("遊戲操作不可刪除房間");
        const after = deleting ? new Map<string, object>() : documents(state, !options.gameplay);
        metrics.writeDocuments += saveChanges(transaction, roomRef, before, after);
        return { value, state, deleting };
      });
      // Never update the cache from inside the transaction callback: it may retry or fail to commit.
      if (result.deleting) decks.delete(roomId); else remember(result.state);
      metrics.ok = true;
      return { value: result.value, state: result.state };
    } finally {
      metrics.retries = Math.max(0, metrics.attempts - 1);
      metrics.transactionMs = performance.now() - start;
      report(options.event ?? "room:update", metrics);
    }
  }

  async function load(transaction: Transaction, roomRef: DocumentReference, roomId: string, gameplay: boolean, metrics: StoreMetrics): Promise<RoomAggregate> {
    const snapshot = await transaction.get(roomRef);
    metrics.readDocuments++;
    if (!snapshot.exists) throw new Error("找不到房間");
    const room = snapshot.data() as RoomRecord;
    room.deckVersion ??= 0;
    delete (room as RoomRecord & { lastResult?: unknown }).lastResult;
    const cached = gameplay ? decks.get(roomId) : undefined;
    const hit = cached?.version === room.deckVersion;
    metrics.cacheHit = hit;
    const cardsPromise = hit ? Promise.resolve(structuredClone(cached.cards)) : transaction.get(roomRef.collection("cards")).then(cards => {
      metrics.cardReads += cards.size;
      metrics.readDocuments += cards.size;
      return cards.docs.map(doc => ({ id: Number(doc.id), ...doc.data() }) as Card).sort((a, b) => a.id - b.id);
    });
    if (gameplay) {
      // playerUids is maintained atomically with membership by all room mutations.
      const refs = room.playerUids.flatMap(uid => [roomRef.collection("players").doc(uid), roomRef.collection("targets").doc(uid)]);
      const [docs, cards] = await Promise.all([refs.length ? transaction.getAll(...refs) : Promise.resolve([]), cardsPromise]);
      metrics.readDocuments += refs.length;
      const players: PlayerRecord[] = [];
      const targets: Record<string, number> = {};
      docs.forEach((doc, index) => {
        if (!doc.exists) return;
        if (index % 2 === 0) players.push({ uid: doc.id, ...doc.data() } as PlayerRecord);
        else targets[doc.id] = doc.data()!.targetCardId as number;
      });
      // Password is intentionally absent from both the read and write sets in this mode.
      return { roomId, room, players, targets, cards, password: null };
    }
    const [players, targets, access, cards] = await Promise.all([
      transaction.get(roomRef.collection("players")), transaction.get(roomRef.collection("targets")),
      transaction.get(roomRef.collection("secrets").doc("access")), cardsPromise,
    ]);
    metrics.readDocuments += players.size + targets.size + 1;
    metrics.secretReads++;
    return {
      roomId, room, cards, password: access.data()?.password ?? null,
      players: players.docs.map(doc => ({ uid: doc.id, ...doc.data() }) as PlayerRecord),
      targets: Object.fromEntries(targets.docs.map(doc => [doc.id, doc.data().targetCardId as number])),
    };
  }

  return {
    updateAggregate,
    async createAggregate(state: RoomAggregate): Promise<RoomAggregate> {
      await db.runTransaction(async transaction => {
        const roomRef = db.doc(`rooms/${state.roomId}`);
        if ((await transaction.get(roomRef)).exists) throw new Error("ROOM_ID_COLLISION");
        saveChanges(transaction, roomRef, new Map(), documents(state, true));
      });
      remember(state);
      return state;
    },
    forgetDeck(roomId: string) { decks.delete(roomId); },
    clearDecks() { decks.clear(); },
    get cachedDecks() { return decks.size; },
  };
}

/** Capture persisted values before mutation; omitting access must never mean deleting it. */
function documents(state: RoomAggregate, includeAccess: boolean): Map<string, object> {
  const docs = new Map<string, object>([["", state.room]]);
  for (const { uid, ...player } of state.players) docs.set(`players/${uid}`, player);
  for (const [uid, targetCardId] of Object.entries(state.targets)) docs.set(`targets/${uid}`, { targetCardId });
  for (const card of state.cards) docs.set(`cards/${card.id}`, { name: card.name, imagePath: card.imagePath });
  if (includeAccess && state.password !== null) docs.set("secrets/access", { password: state.password });
  return structuredClone(docs);
}

function saveChanges(transaction: Transaction, roomRef: DocumentReference, before: Map<string, object>, after: Map<string, object>): number {
  let writes = 0;
  const ref = (path: string) => path ? roomRef.firestore.doc(`${roomRef.path}/${path}`) : roomRef;
  for (const path of before.keys()) if (!after.has(path)) { transaction.delete(ref(path)); writes++; }
  for (const [path, data] of after) if (!isDeepStrictEqual(before.get(path), data)) { transaction.set(ref(path), data); writes++; }
  return writes;
}
