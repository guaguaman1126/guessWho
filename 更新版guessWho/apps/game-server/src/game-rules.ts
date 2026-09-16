import { randomInt } from "node:crypto";
import type { Card, CardCount, GameResult, RetentionPolicy, RoomState, RoomStatus, TurnAction } from "@guesswho/shared/game-types";
import type { GameCommand } from "@guesswho/shared/socket-events";

export type RoomRecord = {
  status: RoomStatus;
  hostUid: string | null;
  playerUids: string[];
  cardCount: CardCount;
  retentionPolicy: RetentionPolicy;
  currentTurnUid: string | null;
  turnAction: TurnAction;
  lastResult: GameResult | null;
  lastEnteredAt: number;
  emptySince: number | null;
  createdAt: number;
  updatedAt: number;
};

export type PlayerRecord = {
  uid: string;
  seat: "A" | "B";
  ready: boolean;
  connected: boolean;
  disconnectDeadline: number | null;
  foldedCardIds: number[];
};

export type RoomAggregate = {
  roomId: string;
  room: RoomRecord;
  players: PlayerRecord[];
  targets: Record<string, number>;
  cards: Card[];
  password: string | null;
};

export type MutationResult = {
  deleteRoom?: boolean;
  imagePathsToDelete?: string[];
};

const validCounts = new Set<CardCount>([9, 16, 25]);

export function createRoom(roomId: string, uid: string, cardCount: CardCount, retentionPolicy: RetentionPolicy, password: string | undefined, now: number): RoomAggregate {
  if (!validCounts.has(cardCount)) fail("卡片數量只能是 9、16 或 25 張");
  if (retentionPolicy !== "delete_when_empty" && retentionPolicy !== "retain") fail("保存方式不正確");
  const cleanPassword = password?.trim() ?? "";
  if (retentionPolicy === "retain" && !cleanPassword) fail("保留房間必須設定密碼");
  return {
    roomId,
    room: { status: "lobby", hostUid: uid, playerUids: [uid], cardCount, retentionPolicy, currentTurnUid: null, turnAction: null, lastResult: null, lastEnteredAt: now, emptySince: null, createdAt: now, updatedAt: now },
    players: [{ uid, seat: "A", ready: false, connected: true, disconnectDeadline: null, foldedCardIds: [] }],
    targets: {},
    cards: Array.from({ length: cardCount }, (_, index) => ({ id: index + 1, name: "", imagePath: "" })),
    password: retentionPolicy === "retain" ? cleanPassword : null,
  };
}

export function joinRoom(state: RoomAggregate, uid: string, password: string | undefined, now: number): void {
  if (state.room.retentionPolicy === "retain" && (password ?? "") !== state.password) fail("房號或密碼不正確");
  let player = state.players.find(item => item.uid === uid);
  if (!player) {
    if (state.players.length >= 2) fail("房間已滿");
    const seat = state.players.some(item => item.seat === "A") ? "B" : "A";
    player = { uid, seat, ready: false, connected: true, disconnectDeadline: null, foldedCardIds: [] };
    state.players.push(player);
  } else {
    player.connected = true;
    player.disconnectDeadline = null;
  }
  if (!state.room.hostUid) state.room.hostUid = uid;
  if (state.room.status === "paused" && state.players.length === 2 && state.players.every(item => item.connected)) state.room.status = "playing";
  state.room.lastEnteredAt = now;
  state.room.emptySince = null;
  touch(state, now);
}

export function applyCommand(state: RoomAggregate, uid: string, command: GameCommand, now: number, chooseFirst: (count: number) => number = randomInt): MutationResult {
  const player = requirePlayer(state, uid);
  const requireLobby = () => { if (state.room.status !== "lobby") fail("只能在大廳操作"); };
  const requireHost = () => { requireLobby(); if (state.room.hostUid !== uid) fail("只有房主能修改"); };
  const requireCard = (id: number) => {
    if (!Number.isInteger(id)) fail("卡片編號不正確");
    const card = state.cards.find(item => item.id === id);
    if (!card) fail("卡片已不存在");
    return card;
  };
  const result: MutationResult = {};

  switch (command.type) {
    case "room:update-settings": {
      requireHost();
      const nextCount = command.payload.cardCount;
      if (!validCounts.has(nextCount)) fail("卡片數量只能是 9、16 或 25 張");
      if (nextCount < state.room.cardCount) {
        result.imagePathsToDelete = state.cards.filter(card => card.id > nextCount).map(card => card.imagePath).filter(Boolean);
        state.cards = state.cards.filter(card => card.id <= nextCount);
        for (const [targetUid, target] of Object.entries(state.targets)) if (target > nextCount) delete state.targets[targetUid];
      } else {
        for (let id = state.room.cardCount + 1; id <= nextCount; id += 1) state.cards.push({ id, name: "", imagePath: "" });
      }
      state.room.cardCount = nextCount;
      break;
    }
    case "card:update": {
      requireHost();
      const card = requireCard(command.payload.cardId);
      if (command.payload.name === undefined && command.payload.imagePath === undefined) fail("沒有卡片變更");
      if (command.payload.name !== undefined) {
        const name = command.payload.name.trim();
        if (name.length > 24) fail("角色名稱最多 24 個字");
        card.name = name;
      }
      if (command.payload.imagePath !== undefined) {
        const path = command.payload.imagePath;
        if (!path.startsWith(`rooms/${state.roomId}/cards/${card.id}/`) || !path.endsWith(".jpg")) fail("圖片路徑不正確");
        if (card.imagePath && card.imagePath !== path) result.imagePathsToDelete = [card.imagePath];
        card.imagePath = path;
      }
      break;
    }
    case "target:select": {
      requireLobby();
      const card = requireCard(command.payload.cardId);
      if (!card.name.trim() || !card.imagePath) fail("請先補齊這張卡片");
      if (uid !== state.room.hostUid && player.ready && state.targets[uid] !== undefined) fail("請先取消準備，再更換目標");
      state.targets[uid] = card.id;
      break;
    }
    case "player:ready":
      requireLobby();
      if (uid === state.room.hostUid) fail("房主直接按開始即可");
      if (command.payload.ready && !validTarget(state, uid)) fail("請先選擇秘密目標");
      player.ready = command.payload.ready;
      break;
    case "game:start": {
      requireHost();
      if (state.players.length !== 2 || state.players.some(item => !item.connected)) fail("等待兩位玩家都上線");
      if (state.cards.length !== state.room.cardCount || state.cards.some(card => !card.name.trim() || !card.imagePath)) fail("請先補齊所有卡片的名稱與圖片");
      if (state.players.some(item => !validTarget(state, item.uid))) fail("雙方都要先選好秘密目標");
      const guest = state.players.find(item => item.uid !== state.room.hostUid);
      if (!guest?.ready) fail("等待另一位玩家按下準備");
      state.room.status = "playing";
      state.room.currentTurnUid = state.players[chooseFirst(state.players.length)]!.uid;
      state.room.turnAction = null;
      state.room.lastResult = null;
      break;
    }
    case "turn:question-complete":
      requireTurn(state, uid);
      if (state.room.turnAction !== null) fail("這個回合已經行動過");
      state.room.turnAction = "question";
      break;
    case "turn:end": {
      requireTurn(state, uid);
      if (state.room.turnAction !== "question") fail("完成口頭提問後才能結束回合");
      state.room.currentTurnUid = otherPlayer(state, uid).uid;
      state.room.turnAction = null;
      break;
    }
    case "game:guess": {
      requireTurn(state, uid);
      if (state.room.turnAction !== null) fail("這個回合已經行動過");
      requireCard(command.payload.cardId);
      const opponent = otherPlayer(state, uid);
      if (state.targets[opponent.uid] === command.payload.cardId) finishGame(state, uid, "correct_guess", now);
      else {
        state.room.currentTurnUid = opponent.uid;
        state.room.turnAction = null;
      }
      break;
    }
    case "card:fold-toggle": {
      if (state.room.status !== "playing") fail("目前不能蓋牌");
      requireCard(command.payload.cardId);
      player.foldedCardIds = player.foldedCardIds.includes(command.payload.cardId)
        ? player.foldedCardIds.filter(id => id !== command.payload.cardId)
        : [...player.foldedCardIds, command.payload.cardId].sort((a, b) => a - b);
      break;
    }
    default:
      fail("不支援的操作");
  }
  touch(state, now);
  return result;
}

export function disconnectPlayer(state: RoomAggregate, uid: string, now: number, graceMs: number): void {
  const player = state.players.find(item => item.uid === uid);
  if (!player || !player.connected) return;
  player.connected = false;
  player.disconnectDeadline = now + graceMs;
  if (state.room.status === "playing") state.room.status = "paused";
  touch(state, now);
}

export function removePlayer(state: RoomAggregate, uid: string, now: number, expiredOnly: boolean): MutationResult {
  const player = state.players.find(item => item.uid === uid);
  if (!player) return {};
  if (expiredOnly && (player.connected || player.disconnectDeadline === null || player.disconnectDeadline > now)) return {};
  const opponent = state.players.find(item => item.uid !== uid && item.connected);
  if ((state.room.status === "playing" || state.room.status === "paused") && opponent) finishGame(state, opponent.uid, "disconnect_forfeit", now);
  state.players = state.players.filter(item => item.uid !== uid);
  delete state.targets[uid];
  if (state.room.hostUid === uid) {
    state.room.hostUid = opponent?.uid ?? state.players.find(item => item.connected)?.uid ?? null;
    const newHost = state.players.find(item => item.uid === state.room.hostUid);
    if (newHost) newHost.ready = false;
  }
  if (state.players.length === 0) {
    if (state.room.retentionPolicy === "delete_when_empty") return { deleteRoom: true, imagePathsToDelete: state.cards.map(card => card.imagePath).filter(Boolean) };
    state.room.status = "lobby";
    state.room.currentTurnUid = null;
    state.room.turnAction = null;
    state.room.emptySince = now;
    state.room.hostUid = null;
    state.targets = {};
  }
  touch(state, now);
  return {};
}

export function toRoomState(state: RoomAggregate, uid: string): RoomState {
  requirePlayer(state, uid);
  return {
    roomId: state.roomId,
    status: state.room.status,
    hostUid: state.room.hostUid,
    cardCount: state.room.cardCount,
    retentionPolicy: state.room.retentionPolicy,
    cards: [...state.cards].sort((a, b) => a.id - b.id),
    players: [...state.players].sort((a, b) => a.seat.localeCompare(b.seat)).map(player => ({
      uid: player.uid,
      name: `玩家 ${player.seat}`,
      seat: player.seat,
      ready: player.ready,
      connected: player.connected,
      hasTarget: validTarget(state, player.uid),
      disconnectDeadline: player.disconnectDeadline,
    })),
    currentTurnUid: state.room.currentTurnUid,
    turnAction: state.room.turnAction,
    self: { uid, targetCardId: state.targets[uid] ?? null, foldedCardIds: [...state.players.find(item => item.uid === uid)!.foldedCardIds] },
    lastResult: state.room.lastResult,
  };
}

function finishGame(state: RoomAggregate, winnerUid: string, reason: GameResult["reason"], now: number): void {
  state.room.status = "lobby";
  state.room.currentTurnUid = null;
  state.room.turnAction = null;
  state.room.lastResult = { winnerUid, reason, endedAt: now };
  state.targets = {};
  for (const player of state.players) {
    player.ready = false;
    player.foldedCardIds = [];
  }
}

function requirePlayer(state: RoomAggregate, uid: string): PlayerRecord {
  const player = state.players.find(item => item.uid === uid);
  if (!player) fail("你不在這個房間");
  return player;
}

function otherPlayer(state: RoomAggregate, uid: string): PlayerRecord {
  const player = state.players.find(item => item.uid !== uid);
  if (!player) fail("等待另一位玩家加入");
  return player;
}

function requireTurn(state: RoomAggregate, uid: string): void {
  if (state.room.status !== "playing" || state.room.currentTurnUid !== uid) fail("現在不是你的回合");
}

function validTarget(state: RoomAggregate, uid: string): boolean {
  const target = state.targets[uid];
  return Number.isInteger(target) && target >= 1 && target <= state.room.cardCount && state.cards.some(card => card.id === target && card.name.trim() && card.imagePath);
}

function touch(state: RoomAggregate, now: number): void {
  state.room.playerUids = state.players.map(player => player.uid);
  state.room.updatedAt = now;
}

function fail(message: string): never {
  throw new Error(message);
}
