import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import express from "express";
import { OAuth2Client } from "google-auth-library";
import { Server } from "socket.io";
import type { Acknowledgment } from "@guesswho/shared/game-types";
import type { ClientEvents, CommandPayloads, GameCommand, ServerEvents } from "@guesswho/shared/socket-events";
import { auth, createAggregate, deleteImages, deleteRoomImages, listRooms, readAggregate, updateAggregate } from "./firebase-admin.js";
import { applyCommand, createRoom, disconnectPlayer, joinRoom, removePlayer, toRoomState } from "./game-rules.js";

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
        const roomId = currentRoom(socket);
        const { value } = await updateAggregate(roomId, state => applyCommand(state, uid, { type, payload } as GameCommand, Date.now()));
        await deleteImages(value.imagePathsToDelete);
        await broadcast(roomId);
        return { ok: true } as const;
      }, ack);
    };

    socket.on("room:create", (payload, ack) => void handle(async () => {
      validateObject(payload);
      let roomId = "";
      for (let attempt = 0; attempt < 5; attempt += 1) {
        roomId = randomBytes(5).toString("base64url").replace(/[-_]/g, "").slice(0, 6).toUpperCase();
        if (roomId.length !== 6) continue;
        try { await createAggregate(createRoom(roomId, uid, payload.cardCount, payload.retentionPolicy, payload.password, Date.now())); break; }
        catch (cause) { if (!(cause instanceof Error) || cause.message !== "ROOM_ID_COLLISION") throw cause; roomId = ""; }
      }
      if (!roomId) throw new Error("暫時無法建立房間，請再試一次");
      await enterSocket(socket, roomId, uid, sockets);
      await broadcast(roomId);
      return { ok: true, roomId } as const;
    }, ack));

    socket.on("room:join", (payload, ack) => void handle(async () => {
      validateObject(payload);
      const roomId = normalizeRoomId(payload.roomId);
      await updateAggregate(roomId, state => joinRoom(state, uid, payload.password, Date.now()));
      await enterSocket(socket, roomId, uid, sockets);
      clearExpiry(roomId, uid, expiryTimers);
      await broadcast(roomId);
      return { ok: true, roomId } as const;
    }, ack));

    socket.on("room:leave", (_payload, ack) => void handle(async () => {
      const roomId = currentRoom(socket);
      const { value } = await updateAggregate(roomId, state => removePlayer(state, uid, Date.now(), false));
      leaveSocket(socket, roomId, uid, sockets);
      clearExpiry(roomId, uid, expiryTimers);
      if (value.deleteRoom) await deleteRoomImages(roomId);
      else await broadcast(roomId);
      return { ok: true } as const;
    }, ack));

    socket.on("room:update-settings", (payload, ack) => run("room:update-settings", payload, ack));
    socket.on("card:update", (payload, ack) => run("card:update", payload, ack));
    socket.on("target:select", (payload, ack) => run("target:select", payload, ack));
    socket.on("player:ready", (payload, ack) => run("player:ready", payload, ack));
    socket.on("game:start", (payload, ack) => run("game:start", payload, ack));
    socket.on("turn:question-complete", (payload, ack) => run("turn:question-complete", payload, ack));
    socket.on("game:guess", (payload, ack) => run("game:guess", payload, ack));
    socket.on("card:fold-toggle", (payload, ack) => run("card:fold-toggle", payload, ack));
    socket.on("turn:end", (payload, ack) => run("turn:end", payload, ack));

    socket.on("disconnect", () => {
      const roomId = socket.data.roomId as string | undefined;
      if (!roomId) return;
      leaveSocket(socket, roomId, uid, sockets);
      if (hasSocket(roomId, uid, sockets)) return;
      void handle(async () => {
        await updateAggregate(roomId, state => disconnectPlayer(state, uid, Date.now(), graceMs));
        await broadcast(roomId);
        scheduleExpiry(roomId, uid);
        return { ok: true } as const;
      });
    });
  });

  async function broadcast(roomId: string): Promise<void> {
    const state = await readAggregate(roomId);
    if (!state) return;
    const roomSockets = sockets.get(roomId);
    if (!roomSockets) return;
    for (const [receiverUid, ids] of roomSockets) {
      let safeState;
      try { safeState = toRoomState(state, receiverUid); } catch { continue; }
      for (const id of ids) io.to(id).emit("room:state", safeState);
    }
  }

  function scheduleExpiry(roomId: string, uid: string): void {
    clearExpiry(roomId, uid, expiryTimers);
    const key = `${roomId}:${uid}`;
    expiryTimers.set(key, setTimeout(() => void handle(async () => {
      const { value } = await updateAggregate(roomId, state => removePlayer(state, uid, Date.now(), true));
      expiryTimers.delete(key);
      if (value.deleteRoom) await deleteRoomImages(roomId);
      else await broadcast(roomId);
      return { ok: true } as const;
    }), graceMs + 25));
  }

  return { app, io, httpServer, close: () => new Promise<void>(resolve => io.close(() => httpServer.close(() => resolve()))) };
}

async function cleanupExpiredRooms(): Promise<number> {
  const cutoff = Date.now() - cleanupAgeMs;
  const expired = (await listRooms()).filter(state => state.room.retentionPolicy === "retain" && state.room.lastEnteredAt <= cutoff);
  let deleted = 0;
  for (const state of expired) {
    const { value } = await updateAggregate(state.roomId, current => ({ deleteRoom: current.room.retentionPolicy === "retain" && current.room.lastEnteredAt <= cutoff }));
    if (value.deleteRoom) { await deleteRoomImages(state.roomId); deleted += 1; }
  }
  return deleted;
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
  try { ack?.(await work()); }
  catch (cause) {
    const message = cause instanceof Error ? safeMessage(cause.message) : "操作失敗";
    ack?.({ ok: false, error: message });
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
  game.httpServer.listen(port, () => console.log(`Game Server ready on http://localhost:${port}`));
  process.on("SIGTERM", () => void game.close());
}
