import assert from "node:assert/strict";
import { getApp, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously, type User } from "firebase/auth";
import { connectStorageEmulator, getDownloadURL, getStorage, ref, uploadBytes, type FirebaseStorage } from "firebase/storage";
import { io, type Socket } from "socket.io-client";
import type { Acknowledgment, GameResult, RoomState } from "@guesswho/shared/game-types";

process.env.FIREBASE_PROJECT_ID = "demo-guesswho";
process.env.FIREBASE_STORAGE_BUCKET = "demo-guesswho.firebasestorage.app";
process.env.WEB_ORIGIN = "http://localhost:3000";
process.env.DISCONNECT_GRACE_MS = "2000";
process.env.CLEANUP_SECRET = "integration-only";

const { createGameServer } = await import("../apps/game-server/src/server.js");
const { auth: adminAuth, db, bucket, readAggregate } = await import("../apps/game-server/src/firebase-admin.js");
const { createRoomStore } = await import("../apps/game-server/src/room-store.js");
const { createRoom, joinRoom, applyCommand } = await import("../apps/game-server/src/game-rules.js");
const { createRoomImageResolver } = await import("../apps/web/src/lib/room-images.js");
assert(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, "Integration tests require local Firebase emulators");
await verifyStore();
const config = { apiKey: "demo", projectId: "demo-guesswho", storageBucket: "demo-guesswho.firebasestorage.app", appId: "demo" };
const latest = new Map<Socket, RoomState>();
const results = new Map<Socket, GameResult>();
const imageRequests = new Map<Socket, number>();
const imageUpdates = new Map<Socket, Promise<unknown>>();
let game = createGameServer();
await game.ready;
await listen(game.httpServer, 0);
let port = (game.httpServer.address() as { port: number }).port;

const host = await client("host");
const guest = await client("guest");
const third = await client("third");

try {
  const created = await emit(host.socket, "room:create", { cardCount: 9, retentionPolicy: "delete_when_empty" });
  assert.equal(created.ok, true);
  const roomId = created.ok ? created.roomId! : "";
  assert.match(roomId, /^[A-Z0-9]{6}$/);
  assert.equal((await emit(guest.socket, "room:join", { roomId })).ok, true);
  assert.deepEqual(await emit(third.socket, "room:join", { roomId }), { ok: false, error: "房間已滿" });

  const jpeg = new Uint8Array([255, 216, 255, 217]);
  for (let cardId = 1; cardId <= 9; cardId += 1) {
    const path = `rooms/${roomId}/cards/${cardId}/integration.jpg`;
    await uploadBytes(ref(host.storage, path), jpeg, { contentType: "image/jpeg" });
    assert.equal((await emit(host.socket, "card:update", { cardId, name: `角色 ${cardId}`, imagePath: path })).ok, true);
  }
  assert.equal((await emit(guest.socket, "card:update", { cardId: 1, name: "玩家編輯" })).ok, true);
  assert.equal((await emit(host.socket, "target:select", { cardId: 1 })).ok, true);
  assert.equal((await emit(guest.socket, "target:select", { cardId: 3 })).ok, true);
  assert.equal((await emit(guest.socket, "player:ready", { ready: true })).ok, true);
  assert.equal((await emit(host.socket, "player:ready", { ready: true })).ok, false);
  assert.equal((await emit(host.socket, "card:update", { cardId: 2, name: "開始前更新" })).ok, true);
  assert.equal((await emit(host.socket, "game:start", {})).ok, true);
  console.log("integration: game started");
  const hostPlaying = await state(host.socket, value => value.status === "playing" && value.self.targetCardId === 1);
  const guestPlaying = await state(guest.socket, value => value.status === "playing" && value.self.targetCardId === 3);
  console.log("integration: both private states received");
  assert.equal(JSON.stringify(hostPlaying).includes('"targetCardId":3'), false);
  assert.equal(JSON.stringify(guestPlaying).includes('"targetCardId":1'), false);
  assert.equal(hostPlaying.cards.find(card => card.id === 2)?.name, "開始前更新");

  const current = hostPlaying.currentTurnUid === host.user.uid ? host : guest;
  const waiting = current === host ? guest : host;
  await Promise.all([imageUpdates.get(host.socket), imageUpdates.get(guest.socket)]);
  const imagesBefore = [imageRequests.get(host.socket), imageRequests.get(guest.socket)];
  const folds: number[] = [], unfolds: number[] = [];
  // A broadcast must not issue a second, non-transactional document read.
  const docPrototype = Object.getPrototypeOf(db.doc(`rooms/${roomId}`));
  const originalGet = docPrototype.get;
  let broadcastReads = 0;
  docPrototype.get = function (...args: unknown[]) { broadcastReads++; return originalGet.apply(this, args); };
  try {
    for (let i = 0; i < 10; i++) {
      for (const times of [folds, unfolds]) {
        const started = performance.now();
        assert.equal((await emit(current.socket, "card:fold-toggle", { cardId: 2 })).ok, true);
        times.push(performance.now() - started);
      }
    }
    assert.equal(broadcastReads, 0, "broadcast must reuse committed state");
    await Promise.all([imageUpdates.get(host.socket), imageUpdates.get(guest.socket)]);
    assert.deepEqual([imageRequests.get(host.socket), imageRequests.get(guest.socket)], imagesBefore, "warm gameplay must make zero new getDownloadURL requests on both clients");
  } finally { docPrototype.get = originalGet; }
  const timing = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return { medianMs: (sorted[4] + sorted[5]) / 2, maxMs: sorted[9] }; };
  console.log("integration: emulator warm operations", JSON.stringify({ fold: timing(folds), unfold: timing(unfolds), broadcastReads }));
  const concurrent = await Promise.all([
    emit(host.socket, "card:fold-toggle", { cardId: 2 }),
    emit(guest.socket, "card:fold-toggle", { cardId: 4 }),
  ]);
  assert(concurrent.every(result => result.ok));
  assert.deepEqual((await state(host.socket, value => value.self.foldedCardIds.includes(2))).self.foldedCardIds, [2]);
  assert.deepEqual((await state(guest.socket, value => value.self.foldedCardIds.includes(4))).self.foldedCardIds, [4]);
  await Promise.all([emit(host.socket, "card:fold-toggle", { cardId: 2 }), emit(guest.socket, "card:fold-toggle", { cardId: 4 })]);
  assert.equal((await emit(current.socket, "card:fold-toggle", { cardId: 2 })).ok, true);
  await state(current.socket, value => value.self.foldedCardIds.includes(2));
  console.log("integration: private fold persisted");
  current.socket.disconnect();
  await state(waiting.socket, value => value.status === "paused");
  console.log("integration: disconnect paused room");
  current.socket = await socketFor(current.user, current.storage);
  assert.equal((await emit(current.socket, "room:join", { roomId })).ok, true);
  console.log("integration: disconnected player rejoined");
  const restored = await state(current.socket, value => value.status === "playing");
  assert.deepEqual(restored.self.foldedCardIds, [2]);
  console.log("integration: reconnect restored private folds");

  host.socket.disconnect(); guest.socket.disconnect();
  await game.close();
  game = createGameServer(); await game.ready; await listen(game.httpServer, port);
  host.socket = await socketFor(host.user, host.storage); guest.socket = await socketFor(guest.user, guest.storage); third.socket = await socketFor(third.user, third.storage);
  assert.equal((await emit(host.socket, "room:join", { roomId })).ok, true);
  assert.equal((await emit(guest.socket, "room:join", { roomId })).ok, true);
  await state(host.socket, value => value.status === "playing");
  console.log("integration: server restart restored room");

  const replacement = await socketFor(host.user, host.storage);
  const joining = emit(replacement, "room:join", { roomId });
  host.socket.disconnect();
  assert.equal((await joining).ok, true);
  host.socket = replacement;
  for (let i = 0; i < 2; i++) assert.equal((await emit(host.socket, "card:fold-toggle", { cardId: 9 })).ok, true);
  assert((await readAggregate(roomId))!.players.every(player => player.connected), "an older disconnect must not overwrite a replacement connection");

  const turn = latest.get(host.socket)!.currentTurnUid === host.user.uid ? host : guest;
  const winningCard = turn === host ? 3 : 1;
  assert.equal((await emit(turn.socket, "game:guess", { cardId: winningCard })).ok, true);
  for (const player of [host, guest]) {
    const lobby = await state(player.socket, value => value.status === "lobby");
    assert.deepEqual(lobby.self.foldedCardIds, []);
    assert.equal(lobby.self.targetCardId, null);
    assert(lobby.players.every(value => !value.ready && !value.hasTarget));
    assert.equal((await gameEnded(player.socket, value => value.reason === "correct_guess")).winnerUid, turn.user.uid);
  }
  await emit(host.socket, "target:select", { cardId: 1 });
  await emit(guest.socket, "target:select", { cardId: 3 });
  await emit(guest.socket, "player:ready", { ready: true });
  assert.equal((await emit(host.socket, "game:start", {})).ok, true);

  host.socket.disconnect();
  await state(guest.socket, value => value.status === "paused");
  const forfeited = await state(guest.socket, value => value.status === "lobby", 5_000);
  const forfeitResult = await gameEnded(guest.socket, value => value.reason === "disconnect_forfeit");
  assert.equal(forfeited.hostUid, guest.user.uid);
  assert.equal(forfeitResult.winnerUid, guest.user.uid);
  assert.equal((await emit(guest.socket, "room:leave", {})).ok, true);
  assert.equal(await readAggregate(roomId), null);
  assert.equal((await bucket.getFiles({ prefix: `rooms/${roomId}/` }))[0].length, 0);

  const retained = await emit(third.socket, "room:create", { cardCount: 9, retentionPolicy: "retain", password: "1234" });
  assert.equal(retained.ok, true);
  const retainedId = retained.ok ? retained.roomId! : "";
  assert.equal((await emit(third.socket, "room:leave", {})).ok, true);
  const intruder = await client("intruder");
  assert.equal((await emit(intruder.socket, "room:join", { roomId: retainedId, password: "wrong" })).ok, false);
  await db.doc(`rooms/${retainedId}`).update({ lastEnteredAt: 1 });
  const response = await fetch(`http://127.0.0.1:${port}/internal/cleanup`, { method: "POST", headers: { authorization: "Bearer integration-only" } });
  assert.equal(response.status, 200);
  assert.equal(await readAggregate(retainedId), null);
  intruder.socket.disconnect();
  console.log("integration: two players, privacy, reconnect, restart, timeout and cleanup passed");
} finally {
  host.socket.disconnect(); guest.socket.disconnect(); third.socket.disconnect();
  await game.close().catch(() => undefined);
}

async function client(name: string) {
  const app = initializeApp(config, `integration-${name}-${crypto.randomUUID()}`);
  const auth = getAuth(app); connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const storage = getStorage(getApp(app.name)); connectStorageEmulator(storage, "127.0.0.1", 9199);
  const user = (await signInAnonymously(auth)).user;
  return { user, storage, socket: await socketFor(user, storage) };
}

async function socketFor(user: User, storage: FirebaseStorage): Promise<Socket> {
  const token = await user.getIdToken();
  // Fail with the actual emulator/configuration error before the server's public error masking.
  await adminAuth.verifyIdToken(token);
  const socket = io(`http://127.0.0.1:${port}`, { auth: { token }, reconnection: false });
  imageRequests.set(socket, 0);
  const images = createRoomImageResolver(path => {
    imageRequests.set(socket, imageRequests.get(socket)! + 1);
    return getDownloadURL(ref(storage, path));
  });
  socket.on("room:state", value => {
    latest.set(socket, value);
    imageUpdates.set(socket, images.resolve(value));
  });
  socket.on("disconnect", () => images.dispose());
  socket.on("game:ended", value => results.set(socket, value));
  await new Promise<void>((resolve, reject) => { socket.once("connect", () => resolve()); socket.once("connect_error", reject); });
  return socket;
}

async function emit(socket: Socket, event: string, payload: object): Promise<Acknowledgment> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timeout`)), 5_000);
    socket.emit(event, payload, (result: Acknowledgment) => { clearTimeout(timer); resolve(result); });
  });
}

async function state(socket: Socket, predicate: (value: RoomState) => boolean, timeout = 5_000): Promise<RoomState> {
  const existing = latest.get(socket); if (existing && predicate(existing)) return existing;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off("room:state", listener); reject(new Error("room:state timeout")); }, timeout);
    const listener = (value: RoomState) => { latest.set(socket, value); if (predicate(value)) { clearTimeout(timer); socket.off("room:state", listener); resolve(value); } };
    socket.on("room:state", listener);
  });
}

async function gameEnded(socket: Socket, predicate: (value: GameResult) => boolean, timeout = 5_000): Promise<GameResult> {
  const existing = results.get(socket); if (existing && predicate(existing)) return existing;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off("game:ended", listener); reject(new Error("game:ended timeout")); }, timeout);
    const listener = (value: GameResult) => { results.set(socket, value); if (predicate(value)) { clearTimeout(timer); socket.off("game:ended", listener); resolve(value); } };
    socket.on("game:ended", listener);
  });
}

async function listen(server: typeof game.httpServer, requestedPort: number): Promise<void> {
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(requestedPort, "127.0.0.1", resolve); });
}

async function verifyStore(): Promise<void> {
  const rows: import("../apps/game-server/src/room-store.js").StoreMetrics[] = [];
  const store = createRoomStore(db, (_event, row) => rows.push(row));
  const initial = createRoom("STORE1", "host", 9, "retain", "test-secret", 1);
  joinRoom(initial, "guest", "test-secret", 2);
  initial.cards.forEach(card => { card.name = `card ${card.id}`; card.imagePath = `rooms/STORE1/cards/${card.id}/test.jpg`; });
  initial.targets = { host: 1, guest: 3 };
  initial.room.status = "playing"; initial.room.currentTurnUid = "host";
  await store.createAggregate(initial);
  try {
    const cardRef = db.doc("rooms/STORE1/cards/1");
    const before = await cardRef.get();
    await store.updateAggregate("STORE1", state => applyCommand(state, "host", { type: "card:fold-toggle", payload: { cardId: 2 } }, 10), { gameplay: true });
    const row = rows.at(-1)!;
    assert.equal(row.readDocuments, 5); assert.equal(row.writeDocuments, 2);
    assert.equal(row.cardReads, 0); assert.equal(row.secretReads, 0);
    assert(before.updateTime!.isEqual((await cardRef.get()).updateTime!), "unchanged card must not be rewritten");
    assert.equal((await db.doc("rooms/STORE1/secrets/access").get()).data()?.password, "test-secret");
    const writer = createRoomStore(db);
    await writer.updateAggregate("STORE1", state => { state.cards[0].name = "new version"; });
    const refreshed = await store.updateAggregate("STORE1", () => undefined, { gameplay: true });
    assert.equal(refreshed.state.cards[0].name, "new version");
    assert.equal(rows.at(-1)?.cardReads, 9);
    store.clearDecks();
    const recovered = await store.updateAggregate("STORE1", () => undefined, { gameplay: true });
    assert.deepEqual(recovered.state.players.find(player => player.uid === "host")?.foldedCardIds, [2]);
    console.log("integration: real Firestore reads/writes, password isolation, deck invalidation and recovery passed");
  } finally { await store.updateAggregate("STORE1", () => ({ deleteRoom: true })); }
}
