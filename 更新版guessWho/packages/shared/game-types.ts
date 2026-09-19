export type CardCount = 9 | 16 | 25;
export type RoomStatus = "lobby" | "playing" | "paused";
export type RetentionPolicy = "delete_when_empty" | "retain";
export interface Card { id: number; name: string; imagePath: string }
export interface PublicPlayer {
  uid: string; name: string; seat: "A" | "B"; ready: boolean;
  connected: boolean; hasTarget: boolean; disconnectDeadline: number | null;
}
export interface GameResult { winnerUid: string; reason: "correct_guess" | "disconnect_forfeit" }
export interface RoomState {
  roomId: string; status: RoomStatus; hostUid: string | null;
  cardCount: CardCount; retentionPolicy: RetentionPolicy; cards: Card[];
  players: PublicPlayer[]; currentTurnUid: string | null;
  // 私人欄位只包含接收者自己的資料，不包含對手答案或排除筆記。
  self: { uid: string; targetCardId: number | null; foldedCardIds: number[] };
}
export type Acknowledgment = { ok: true; roomId?: string } | { ok: false; error: string };
