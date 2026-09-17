import type { Acknowledgment, CardCount, RetentionPolicy, RoomState } from "./game-types.js";
export interface CommandPayloads {
  "room:create": { cardCount: CardCount; retentionPolicy: RetentionPolicy; password?: string };
  "room:join": { roomId: string; password?: string };
  "room:leave": Record<string, never>;
  "room:update-settings": { cardCount: CardCount };
  "card:update": { cardId: number; name?: string; imagePath?: string };
  "target:select": { cardId: number };
  "player:ready": { ready: boolean };
  "game:start": Record<string, never>;
  "turn:question-complete": Record<string, never>;
  "game:guess": { cardId: number };
  "card:fold-toggle": { cardId: number };
}
export type ClientEvents = { [K in keyof CommandPayloads]: (payload: CommandPayloads[K], ack: (result: Acknowledgment) => void) => void };
export interface ServerEvents { "room:state": (state: RoomState) => void; "room:error": (message: string) => void }
export type GameCommand = { [K in keyof CommandPayloads]: { type: K; payload: CommandPayloads[K] } }[keyof CommandPayloads];
