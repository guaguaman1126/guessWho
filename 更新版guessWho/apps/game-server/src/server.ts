import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import express from "express";
import { OAuth2Client } from "google-auth-library";
import { Server } from "socket.io";
import type { Acknowledgment, GameResult } from "@guesswho/shared/game-types";
import type { ClientEvents, CommandPayloads, GameCommand, ServerEvents } from "@guesswho/shared/socket-events";
import { auth, db, deleteImages, deleteRoomImages, listRooms } from "./firebase-admin.js";
import { applyCommand, createRoom, disconnectPlayer, joinRoom, removePlayer, toRoomState, type RoomAggregate } from "./game-rules.js";
import { createRoomStore } from "./room-store.js";
import { createRoomQueue } from "./room-queue.js";

const roomIdPattern = /^[A-Z0-9]{6}$/;
const graceMs = Number(process.env.DISCONNECT_GRACE_MS ?? 60_000);
const cleanupAgeMs = Number(process.env.ROOM_RETENTION_MS ?? 30 * 24 * 60 * 60 * 1000);

export function createGameServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server<ClientEvents, ServerEvents>(httpServer, { cors: { origin: process.env.WEB_ORIGIN ?? "http://localhost:3000" } });
  const sockets = new Map<string, Map<string, Set<string>>>();
  const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const oauth = new OAuth2Client();
  let shuttingDown = false;
  const store = createRoomStore(db);
  const queue = createRoomQueue();
  const { createAggregate, updateAggregate } = store;

  function inRoom<T>(roomId: string, event: string, work: () => Promise<T>): Promise<T> {
    if (shuttingDown) return Promise.reject(new Error("伺服器正在關閉"));
    return queue.run(roomId, event, async () => {
      try { return await work(); }
      finally { if (!sockets.has(roomId)) store.forgetDeck(roomId); }
    });
  }

  async function attach(socket: Parameters<typeof enterSocket>[0] & { connected: boolean }, state: RoomAggregate, uid: string): Promise<RoomAggregate> {
    if (socket.connected) {
      await enterSocket(socket, state.roomId, uid, sockets);
      clearExpiry(state.roomId, uid, expiryTimers);
      if (socket.connected) return state;
      leaveSocket(socket, state.roomId, uid, sockets);
    }
    // The connection may disappear while join/create waits for Firestore.
    if (hasSocket(state.roomId, uid, sockets)) return state;
    const updated = await updateAggregate(state.roomId, current => disconnectPlayer(current, uid, Date.now(), graceMs), { event: "room:attach-disconnected" });
    scheduleExpiry(state.roomId, uid);
    return updated.state;
  }

  app.disable("x-powered-by");
  app.get("/health", (_req, res) => res.json({ ok: true, stage: "ready", gameReady: true }));
  app.post("/internal/cleanup", express.json(), async (req, res) => {
    if (!(await cleanupAuthorized(req.headers.authorization, oauth))) return res.status(401).json({ ok: false });
    const deleted = await cleanupExpiredRooms();
    return res.json({ ok: true, deleted });
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (typeof token !== "string" || !token) throw new Error("缺少登入憑證");
      socket.data.uid = (await auth.verifyIdToken(token)).uid;
      next();
    } catch { next(new Error("登入驗證失敗")); }
  });

  io.on("connection", socket => {
    const uid = socket.data.uid as string;
    const run = <K extends keyof CommandPayloads>(type: K, payload: CommandPayloads[K], ack: (result: Acknowledgment) => void) => {
      void handle(async () => {
        validateObject(payload);
        const roomId = currentRoom(socket);
        return inRoom(roomId, type, async () => {
          if (currentRoom(socket) !== roomId) throw new Error("請先加入房間");
          const gameplay = type !== "card:update" && type !== "room:update-settings";
          const { value, state } = await updateAggregate(roomId, current => applyCommand(current, uid, { type, payload } as GameCommand, Date.now()), { gameplay, event: type });
          await deleteImages(value.imagePathsToDelete);
          broadcast(state, value.gameEnded);
          return { ok: true } as const;
        });
      }, ack);
    };

    socket.on("room:create", (payload, ack) => void handle(async () => {
      validateObject(payload);
      let roomId = "";
      for (let attempt = 0; attempt < 5; attempt += 1) {
        roomId = randomBytes(5).toString("base64url").replace(/[-_]/g, "").slice(0, 6).toUpperCase();
        if (roomId.length !== 6) continue;
        try {
          return await inRoom(roomId, "room:create", async () => {
            const state = await createAggregate(createRoom(roomId, uid, payload.cardCount, payload.retentionPolicy, payload.password, Date.now()));
            broadcast(await attach(socket, state, uid));
            return { ok: true, roomId } as const;
          });
        }
        catch (cause) { if (!(cause instanceof Error) || cause.message !== "ROOM_ID_COLLISION") throw cause; roomId = ""; }
      }
      throw new Error("暫時無法建立房間，請再試一次");
    }, ack));

    socket.on("room:join", (payload, ack) => void handle(async () => {
      validateObject(payload);
      const roomId = normalizeRoomId(payload.roomId);
      return inRoom(roomId, "room:join", async () => {
        if (socket.data.roomId && socket.data.roomId !== roomId) throw new Error("請先離開目前房間");
        const { state } = await updateAggregate(roomId, current => joinRoom(current, uid, payload.password, Date.now()), { event: "room:join" });
        broadcast(await attach(socket, state, uid));
        return { ok: true, roomId } as const;
      });
    }, ack));

    socket.on("room:leave", (_payload, ack) => void handle(async () => {
      const roomId = currentRoom(socket);
      return inRoom(roomId, "room:leave", async () => {
        if (currentRoom(socket) !== roomId) throw new Error("請先加入房間");
        const { value, state } = await updateAggregate(roomId, current => removePlayer(current, uid, Date.now(), false), { event: "room:leave" });
        leaveSocket(socket, roomId, uid, sockets);
        clearExpiry(roomId, uid, expiryTimers);
        if (value.deleteRoom) await deleteRoomImages(roomId);
        else broadcast(state, value.gameEnded);
        return { ok: true } as const;
      });
    }, ack));

    socket.on("room:update-settings", (payload, ack) => run("room:update-settings", payload, ack));
    socket.on("card:update", (payload, ack) => run("card:update", payload, ack));
    socket.on("target:select", (payload, ack) => run("target:select", payload, ack));
    socket.on("player:ready", (payload, ack) => run("player:ready", payload, ack));
    socket.on("game:start", (payload, ack) => run("game:start", payload, ack));
    socket.on("turn:question-complete", (payload, ack) => run("turn:question-complete", payload, ack));
    socket.on("game:guess", (payload, ack) => run("game:guess", payload, ack));
    socket.on("card:fold-toggle", (payload, ack) => run("card:fold-toggle", payload, ack));

    socket.on("disconnect", () => {
      if (shuttingDown) return;
      const roomId = socket.data.roomId as string | undefined;
      if (!roomId) return;
      void handle(() => inRoom(roomId, "disconnect", async () => {
        if (socket.data.roomId !== roomId) return { ok: true } as const;
        leaveSocket(socket, roomId, uid, sockets);
        if (hasSocket(roomId, uid, sockets)) return { ok: true } as const;
        const { state } = await updateAggregate(roomId, current => disconnectPlayer(current, uid, Date.now(), graceMs), { event: "disconnect" });
        broadcast(state);
        scheduleExpiry(roomId, uid);
        return { ok: true } as const;
      }));
    });
  });

  function broadcast(state: RoomAggregate, gameEnded?: GameResult): void {
    const roomSockets = sockets.get(state.roomId);
    if (!roomSockets) return;
    for (const [receiverUid, ids] of roomSockets) {
      let safeState;
      try { safeState = toRoomState(state, receiverUid); } catch { continue; }
      for (const id of ids) {
        io.to(id).emit("room:state", safeState);
        // ponytail: 結算只通知目前在線的 Socket；若日後需要補送，再改成持久化結果。
        if (gameEnded) io.to(id).emit("game:ended", gameEnded);
      }
    }
  }

  function scheduleExpiry(roomId: string, uid: string): void {
    clearExpiry(roomId, uid, expiryTimers);
    const key = `${roomId}:${uid}`;
    const timer = setTimeout(() => void handle(() => inRoom(roomId, "room:expire", async () => {
      if (expiryTimers.get(key) !== timer) return { ok: true } as const;
      const { value, state } = await updateAggregate(roomId, current => removePlayer(current, uid, Date.now(), true), { event: "room:expire" });
      expiryTimers.delete(key);
      if (value.deleteRoom) await deleteRoomImages(roomId);
      else broadcast(state, value.gameEnded);
      return { ok: true } as const;
    })), graceMs + 25);
    expiryTimers.set(key, timer);
  }

  async function cleanupExpiredRooms(): Promise<number> {
    const cutoff = Date.now() - cleanupAgeMs;
    const expired = (await listRooms()).filter(state => state.room.retentionPolicy === "retain" && state.room.lastEnteredAt <= cutoff);
    let deleted = 0;
    for (const room of expired) {
      await inRoom(room.roomId, "room:cleanup", async () => {
        const { value } = await updateAggregate(room.roomId, current => ({ deleteRoom: current.room.retentionPolicy === "retain" && current.room.lastEnteredAt <= cutoff }), { event: "room:cleanup" });
        if (value.deleteRoom) { await deleteRoomImages(room.roomId); deleted++; }
      });
    }
    return deleted;
  }

  const ready = reconcileAfterRestart();
  async function reconcileAfterRestart(): Promise<void> {
    const now = Date.now();
    for (const room of await listRooms()) {
      for (const player of room.players.filter(item => item.connected)) {
        await inRoom(room.roomId, "room:recover", async () => {
          await updateAggregate(room.roomId, state => disconnectPlayer(state, player.uid, now, graceMs), { event: "room:recover" });
          scheduleExpiry(room.roomId, player.uid);
        });
      }
    }
  }

  return {
    app, io, httpServer, ready,
    close: async () => {
      shuttingDown = true;
      for (const timer of expiryTimers.values()) clearTimeout(timer);
      expiryTimers.clear();
      await queue.drain();
      for (const timer of expiryTimers.values()) clearTimeout(timer);
      expiryTimers.clear();
      store.clearDecks();
      await new Promise<void>(resolve => io.close(() => httpServer.close(() => resolve())));
    },
  };
}

async function cleanupAuthorized(header: string | undefined, oauth: OAuth2Client): Promise<boolean> {
  const secret = process.env.CLEANUP_SECRET;
  if (secret && header === `Bearer ${secret}`) return true;
  const audience = process.env.CLEANUP_AUDIENCE;
  const schedulerEmail = process.env.CLEANUP_SCHEDULER_SERVICE_ACCOUNT;
  if (!audience || !schedulerEmail || !header?.startsWith("Bearer ")) return false;
  try {
    const ticket = await oauth.verifyIdToken({ idToken: header.slice(7), audience });
    return ticket.getPayload()?.email === schedulerEmail;
  } catch { return false; }
}

async function handle<T extends Acknowledgment>(work: () => Promise<T>, ack?: (result: Acknowledgment) => void): Promise<void> {
  try {
    const result = await work();
    if (ack) ack(result);
  }
  catch (cause) {
    const message = cause instanceof Error ? safeMessage(cause.message) : "操作失敗";
    if (ack) ack({ ok: false, error: message });
    else console.error(`[game-server] ${message}`);
  }
}

function safeMessage(message: string): string {
  if (message.includes("password") || message.includes("密碼")) return "房號或密碼不正確";
  return message || "操作失敗";
}

function validateObject(value: unknown): asserts value is object {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("資料格式不正確");
}

function normalizeRoomId(value: unknown): string {
  const roomId = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!roomIdPattern.test(roomId)) throw new Error("房號格式不正確");
  return roomId;
}

function currentRoom(socket: { data: Record<string, unknown> }): string {
  const roomId = socket.data.roomId;
  if (typeof roomId !== "string") throw new Error("請先加入房間");
  return roomId;
}

async function enterSocket(socket: { id: string; data: Record<string, unknown>; join(room: string): Promise<void> | void }, roomId: string, uid: string, sockets: Map<string, Map<string, Set<string>>>): Promise<void> {
  socket.data.roomId = roomId;
  await socket.join(roomId);
  const room = sockets.get(roomId) ?? new Map<string, Set<string>>();
  const ids = room.get(uid) ?? new Set<string>();
  ids.add(socket.id); room.set(uid, ids); sockets.set(roomId, room);
}

function leaveSocket(socket: { id: string; data: Record<string, unknown> }, roomId: string, uid: string, sockets: Map<string, Map<string, Set<string>>>): void {
  const room = sockets.get(roomId); const ids = room?.get(uid);
  ids?.delete(socket.id);
  if (ids?.size === 0) room?.delete(uid);
  if (room?.size === 0) sockets.delete(roomId);
  delete socket.data.roomId;
}

function hasSocket(roomId: string, uid: string, sockets: Map<string, Map<string, Set<string>>>): boolean {
  return Boolean(sockets.get(roomId)?.get(uid)?.size);
}

function clearExpiry(roomId: string, uid: string, timers: Map<string, ReturnType<typeof setTimeout>>): void {
  const key = `${roomId}:${uid}`;
  const timer = timers.get(key);
  if (timer) clearTimeout(timer);
  timers.delete(key);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const game = createGameServer();
  const port = Number(process.env.PORT ?? 4000);
  void game.ready.then(() => game.httpServer.listen(port, () => console.log(`Game Server ready on http://localhost:${port}`)));
  process.on("SIGTERM", () => void game.close());
}
