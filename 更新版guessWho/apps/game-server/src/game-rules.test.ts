import assert from "node:assert/strict";
import test from "node:test";
import { applyCommand, createRoom, disconnectPlayer, joinRoom, removePlayer, toRoomState } from "./game-rules.js";

function readyRoom() {
  const room = createRoom("ABC123", "host", 9, "delete_when_empty", undefined, 1);
  joinRoom(room, "guest", undefined, 2);
  for (const card of room.cards) { card.name = `角色 ${card.id}`; card.imagePath = `rooms/ABC123/cards/${card.id}/test.jpg`; }
  applyCommand(room, "host", { type: "target:select", payload: { cardId: 1 } }, 3);
  applyCommand(room, "guest", { type: "target:select", payload: { cardId: 3 } }, 4);
  applyCommand(room, "guest", { type: "player:ready", payload: { ready: true } }, 5);
  return room;
}

test("房主不必準備，開始後目標不會洩漏", () => {
  const room = readyRoom();
  assert.throws(() => applyCommand(room, "host", { type: "player:ready", payload: { ready: true } }, 6), /房主/);
  applyCommand(room, "host", { type: "game:start", payload: {} }, 7, () => 0);
  assert.equal(room.room.currentTurnUid, "host");
  assert.equal(toRoomState(room, "host").self.targetCardId, 1);
  assert.equal(JSON.stringify(toRoomState(room, "host")).includes('"targetCardId":3'), false);
});

test("縮減卡組保留準備，只清除失效目標與圖片", () => {
  const room = readyRoom();
  applyCommand(room, "host", { type: "room:update-settings", payload: { cardCount: 16 } }, 6);
  room.targets.guest = 16;
  const result = applyCommand(room, "host", { type: "room:update-settings", payload: { cardCount: 9 } }, 7);
  assert.equal(room.players.find(player => player.uid === "guest")?.ready, true);
  assert.equal(room.targets.guest, undefined);
  assert.equal(room.cards.length, 9);
  assert.deepEqual(result.imagePathsToDelete, []);
});

test("大廳內兩位玩家都能修改角色卡，開始後都不能修改", () => {
  const room = readyRoom();
  applyCommand(room, "host", { type: "card:update", payload: { cardId: 1, name: "房主修改" } }, 6);
  applyCommand(room, "guest", { type: "card:update", payload: { cardId: 2, name: "玩家修改" } }, 7);
  assert.equal(room.cards[0]?.name, "房主修改");
  assert.equal(room.cards[1]?.name, "玩家修改");

  applyCommand(room, "host", { type: "game:start", payload: {} }, 8, () => 0);
  assert.throws(() => applyCommand(room, "host", { type: "card:update", payload: { cardId: 1, name: "不能修改" } }, 9), /只能在大廳/);
  assert.throws(() => applyCommand(room, "guest", { type: "card:update", payload: { cardId: 2, name: "不能修改" } }, 10), /只能在大廳/);
});

test("完成提問後立即換到另一位玩家", () => {
  const room = readyRoom();
  applyCommand(room, "host", { type: "game:start", payload: {} }, 6, () => 0);
  applyCommand(room, "host", { type: "turn:question-complete", payload: {} }, 7);
  assert.equal(room.room.currentTurnUid, "guest");
  assert.throws(() => applyCommand(room, "host", { type: "turn:question-complete", payload: {} }, 8), /現在不是你的回合/);
  applyCommand(room, "guest", { type: "turn:question-complete", payload: {} }, 9);
  assert.equal(room.room.currentTurnUid, "host");
});

test("蓋牌會保存，猜錯自動換回合，猜中回大廳", () => {
  const room = readyRoom();
  applyCommand(room, "host", { type: "game:start", payload: {} }, 6, () => 0);
  applyCommand(room, "host", { type: "card:fold-toggle", payload: { cardId: 2 } }, 7);
  assert.deepEqual(toRoomState(room, "host").self.foldedCardIds, [2]);
  applyCommand(room, "host", { type: "game:guess", payload: { cardId: 2 } }, 8);
  assert.equal(room.room.currentTurnUid, "guest");
  const result = applyCommand(room, "guest", { type: "game:guess", payload: { cardId: 1 } }, 9);
  assert.equal(room.room.status, "lobby");
  assert.deepEqual(result.gameEnded, { winnerUid: "guest", reason: "correct_guess" });
  assert.deepEqual(room.targets, {});
});

test("斷線保留座位，逾時判負並移交房主", () => {
  const room = readyRoom();
  applyCommand(room, "host", { type: "game:start", payload: {} }, 6, () => 0);
  disconnectPlayer(room, "host", 10, 60_000);
  assert.equal(room.room.status, "paused");
  const result = removePlayer(room, "host", 70_001, true);
  assert.equal(room.room.hostUid, "guest");
  assert.deepEqual(result.gameEnded, { winnerUid: "guest", reason: "disconnect_forfeit" });
  assert.equal(room.room.status, "lobby");
});
