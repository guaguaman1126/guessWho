import assert from "node:assert/strict";
import { getApp, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously, type User } from "firebase/auth";
import { connectStorageEmulator, getStorage, ref, uploadBytes } from "firebase/storage";
import { io, type Socket } from "socket.io-client";
import type { Acknowledgment, RoomState } from "@guesswho/shared/game-types";

process.env.FIREBASE_PROJECT_ID = "demo-guesswho";
process.env.FIREBASE_STORAGE_BUCKET = "demo-guesswho.firebasestorage.app";
process.env.WEB_ORIGIN = "http://localhost:3000";
process.env.DISCONNECT_GRACE_MS = "2000";
process.env.CLEANUP_SECRET = "integration-only";

const { createGameServer } = await import("../apps/game-server/src/server.js");
const { db, bucket, readAggregate } = await import("../apps/game-server/src/firebase-admin.js");
const config = { apiKey: "demo", projectId: "demo-guesswho", storageBucket: "demo-guesswho.firebasestorage.app", appId: "demo" };
const latest = new Map<Socket, RoomState>();
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
  assert.equal((await emit(guest.socket, "card:update", { cardId: 1, name: "作弊" })).ok, false);
  assert.equal((await emit(host.socket, "target:select", { cardId: 1 })).ok, true);
  assert.equal((await emit(guest.socket, "target:select", { cardId: 3 })).ok, true);
  assert.equal((await emit(guest.socket, "player:ready", { ready: true })).ok, true);
  assert.equal((await emit(host.socket, "player:ready", { ready: true })).ok, false);
  assert.equal((await emit(host.socket, "game:start", {})).ok, true);
  console.log("integration: game started");
  const hostPlaying = await state(host.socket, value => value.status === "playing" && value.self.targetCardId === 1);
  const guestPlaying = await state(guest.socket, value => value.status === "playing" && value.self.targetCardId === 3);
  console.log("integration: both private states received");
  assert.equal(JSON.stringify(hostPlaying).includes('"targetCardId":3'), false);
  assert.equal(JSON.stringify(guestPlaying).includes('"targetCardId":1'), false);

  const current = hostPlaying.currentTurnUid === host.user.uid ? host : guest;
  const waiting = current === host ? guest : host;
  assert.equal((await emit(current.socket, "card:fold-toggle", { cardId: 2 })).ok, true);
  await state(current.socket, value => value.self.foldedCardIds.includes(2));
  console.log("integration: private fold persisted");
  current.socket.disconnect();
  await state(waiting.socket, value => value.status === "paused");
  console.log("integration: disconnect paused room");
  current.socket = await socketFor(current.user);
  assert.equal((await emit(current.socket, "room:join", { roomId })).ok, true);
  console.log("integration: disconnected player rejoined");
  const restored = await state(current.socket, value => value.status === "playing");
  assert.deepEqual(restored.self.foldedCardIds, [2]);
  console.log("integration: reconnect restored private folds");

  host.socket.disconnect(); guest.socket.disconnect();
  await game.close();
  game = createGameServer(); await game.ready; await listen(game.httpServer, port);
  host.socket = await socketFor(host.user); guest.socket = await socketFor(guest.user); third.socket = await socketFor(third.user);
  assert.equal((await emit(host.socket, "room:join", { roomId })).ok, true);
  assert.equal((await emit(guest.socket, "room:join", { roomId })).ok, true);
  await state(host.socket, value => value.status === "playing");
  console.log("integration: server restart restored room");

  host.socket.disconnect();
  await state(guest.socket, value => value.status === "paused");
  const forfeited = await state(guest.socket, value => value.status === "lobby" && value.lastResult?.reason === "disconnect_forfeit", 5_000);
  assert.equal(forfeited.hostUid, guest.user.uid);
  assert.equal(forfeited.lastResult?.winnerUid, guest.user.uid);
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
  return { user, storage, socket: await socketFor(user) };
}

async function socketFor(user: User): Promise<Socket> {
  const socket = io(`http://127.0.0.1:${port}`, { auth: { token: await user.getIdToken() }, reconnection: false });
  socket.on("room:state", value => latest.set(socket, value));
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

async function listen(server: typeof game.httpServer, requestedPort: number): Promise<void> {
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(requestedPort, "127.0.0.1", resolve); });
}
