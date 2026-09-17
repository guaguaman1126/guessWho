"use client";

import { useEffect, useRef, useState } from "react";
import type { Card, CardCount, RetentionPolicy, RoomState } from "@guesswho/shared/game-types";
import type { GameCommand } from "@guesswho/shared/socket-events";

const names = ["阿栗", "小葵", "木木", "大福", "橘子", "阿藍", "米米", "花花", "阿哲", "小夏", "豆豆", "可可", "阿森", "露露", "小麥", "阿莫", "桃子", "阿樂", "小松", "果果", "阿白", "小雨", "茶茶", "阿海", "圓圓"];
export const sampleCards: Card[] = names.map((name, index) => ({ id: index + 1, name, imagePath: `/assets/characters/${index + 1}.svg` }));
export type Persona = "host" | "guest";
export type Scenario = "lobby" | "playing" | "opponent" | "paused" | "win" | "lose" | "loading" | "error" | "missing" | "transfer";
export const demoEnabled = process.env.NEXT_PUBLIC_DEMO_MODE === "true"
  || (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DEMO_MODE !== "false");

export function initialRoom(roomId: string, count: CardCount, retention: RetentionPolicy): RoomState {
  return { roomId, status: "lobby", hostUid: "host", cardCount: count, retentionPolicy: retention,
    cards: sampleCards.slice(0, count).map(card => ({ ...card })),
    players: [
      { uid: "host", name: "你", seat: "A", ready: false, connected: true, hasTarget: false, disconnectDeadline: null },
      { uid: "guest", name: "小夥伴", seat: "B", ready: false, connected: true, hasTarget: false, disconnectDeadline: null },
    ], currentTurnUid: null,
    self: { uid: "host", targetCardId: null, foldedCardIds: [] }, lastResult: null };
}

// 僅供第二階段的本地展示。日後以 Socket acknowledgment / room:state 替換此入口。
// 這裡沒有 Firebase 初始化、真實多人同步或正式遊戲裁判。
export function useDemoRoom(roomId: string, count: CardCount, retention: RetentionPolicy, persona: Persona) {
  const [room, setRoom] = useState(() => initialRoom(roomId, count, retention));
  const [uid, setUid] = useState<Persona>(persona);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [remaining, setRemaining] = useState(60);
  const privateNotes = useRef<Record<Persona, { target: number | null; folded: number[] }>>({ host: { target: null, folded: [] }, guest: { target: null, folded: [] } });
  const lock = useRef(false);
  const failNext = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const timer = setTimeout(() => setLoading(false), 450);
    return () => { mounted.current = false; clearTimeout(timer); };
  }, []);
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setLoading(false), 1000);
    return () => clearTimeout(timer);
  }, [loading]);

  const notes = privateNotes.current[uid];
  const state: RoomState = { ...room, self: { uid, targetCardId: notes.target, foldedCardIds: notes.folded } };
  const me = state.players.find(player => player.uid === uid)!;
  const isHost = uid === state.hostUid;
  const allTargets = state.players.every(player => player.hasTarget);
  const startReason = state.players.some(player => !player.connected) ? "等待兩位玩家都上線"
    : state.cards.some(card => !card.name.trim() || !card.imagePath) ? "請先補齊所有卡片的名稱與圖片"
    : !allTargets ? "雙方都要先選好秘密目標"
    : !state.players.find(player => player.uid !== state.hostUid)?.ready ? "等待另一位玩家按下準備"
    : "";

  function finish(current: RoomState, winner: string, reason: "correct_guess" | "disconnect_forfeit"): RoomState {
    privateNotes.current = { host: { target: null, folded: [] }, guest: { target: null, folded: [] } };
    return { ...current, status: "lobby", currentTurnUid: null,
      players: current.players.map(player => ({ ...player, ready: false, hasTarget: false, connected: true, disconnectDeadline: null })),
      lastResult: { winnerUid: winner, reason, endedAt: Date.now() } };
  }

  useEffect(() => {
    if (room.status !== "paused") return;
    const deadline = room.players.find(player => !player.connected)?.disconnectDeadline ?? Date.now() + 60000;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0) {
        const online = room.players.find(player => player.connected)!;
        setRoom(current => finish(current, online.uid, "disconnect_forfeit"));
        setNotice("展示：對手逾時，這一局結束了");
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [room.status, room.players]);

  async function send(command: GameCommand): Promise<boolean> {
    if (lock.current || loading) return false;
    lock.current = true; setBusy(true); setError("");
    await new Promise(resolve => setTimeout(resolve, 200));
    if (!mounted.current) return false;
    try {
      if (failNext.current) { failNext.current = false; throw new Error("展示：這次操作未成功，資料沒有變更，請再試一次。"); }
      const current = structuredClone(room);
      const mine = current.players.find(player => player.uid === uid)!;
      const myNotes = privateNotes.current[uid];
      const isLobby = current.status === "lobby";
      const myTurn = current.status === "playing" && current.currentTurnUid === uid;
      const requireLobby = () => { if (!isLobby) throw new Error("只能在大廳操作"); };
      const requireHost = () => { requireLobby(); if (uid !== current.hostUid) throw new Error("只有房主能修改"); };
      const cardFor = (id: number) => { const card = current.cards.find(card => card.id === id); if (!card) throw new Error("卡片已不存在"); return card; };
      switch (command.type) {
        case "room:update-settings": {
          requireHost();
          const nextCount = command.payload.cardCount;
          current.cards = Array.from({ length: nextCount }, (_, index) => current.cards[index] ?? { id: index + 1, name: "", imagePath: "" });
          current.cardCount = nextCount;
          for (const player of current.players) {
            const note = privateNotes.current[player.uid as Persona];
            if (note.target && note.target > nextCount) { note.target = null; player.hasTarget = false; }
          }
          setNotice("卡組已更新；有效目標與準備狀態已保留");
          break;
        }
        case "card:update": {
          requireLobby();
          const card = cardFor(command.payload.cardId);
          if (command.payload.name !== undefined) card.name = command.payload.name.trim();
          if (command.payload.imagePath !== undefined) card.imagePath = command.payload.imagePath;
          setNotice("卡片已更新（僅保留於本次展示）"); break;
        }
        case "target:select":
          requireLobby();
          if (uid !== current.hostUid && mine.ready && myNotes.target) throw new Error("請先取消準備，再更換目標");
          if (!cardFor(command.payload.cardId).imagePath || !cardFor(command.payload.cardId).name) throw new Error("請先補齊這張卡片");
          myNotes.target = command.payload.cardId; mine.hasTarget = true;
          setNotice("秘密目標已選好，只有你看得到"); break;
        case "player:ready":
          requireLobby();
          if (uid === current.hostUid) throw new Error("房主直接按開始即可");
          if (command.payload.ready && !myNotes.target) throw new Error("請先選擇秘密目標");
          mine.ready = command.payload.ready; break;
        case "game:start":
          requireHost();
          if (startReason) throw new Error(startReason);
          current.status = "playing"; current.currentTurnUid = uid; current.lastResult = null;
          setNotice("展示局開始，由你先手"); break;
        case "card:fold-toggle":
          if (current.status !== "playing") throw new Error("目前不能蓋牌");
          cardFor(command.payload.cardId);
          myNotes.folded = myNotes.folded.includes(command.payload.cardId) ? myNotes.folded.filter(id => id !== command.payload.cardId) : [...myNotes.folded, command.payload.cardId];
          break;
        case "turn:question-complete":
          if (!myTurn) throw new Error("現在不能提問");
          current.currentTurnUid = uid === "host" ? "guest" : "host"; break;
        case "game:guess":
          if (!myTurn) throw new Error("目前不能指認");
          cardFor(command.payload.cardId);
          // 示範答案只存在 mock 入口，不會放入 RoomState。
          if (command.payload.cardId === privateNotes.current[uid === "host" ? "guest" : "host"].target) {
            setRoom(finish(current, uid, "correct_guess")); setNotice("猜中了！回到大廳，再來一局。"); return true;
          }
          current.currentTurnUid = uid === "host" ? "guest" : "host";
          setNotice("猜錯了，現在換對方的回合"); break;
        default: throw new Error("此功能尚未連接正式服務");
      }
      setRoom(current);
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失敗"); return false; }
    finally { lock.current = false; setBusy(false); }
  }

  function scenario(value: Scenario) {
    if (lock.current) return;
    setError(""); setNotice("");
    if (value === "loading") { setLoading(true); return; }
    if (value === "error") { failNext.current = true; setNotice("下一次操作將示範失敗；重試即可成功"); return; }
    let current = structuredClone(room);
    current.lastResult = null;
    if (value === "lobby" || value === "win" || value === "lose") {
      current = finish(current, value === "lose" ? (uid === "host" ? "guest" : "host") : uid, "correct_guess");
      if (value === "lobby") current.lastResult = null;
    } else if (value === "missing") {
      current.status = "lobby"; current.cards[0].imagePath = "";
    } else if (value === "transfer") {
      current = finish(current, uid, "disconnect_forfeit");
      current.hostUid = uid === "host" ? "guest" : "host";
      setNotice("展示：房主權限已移交，雙方需重新選目標");
    } else {
      current.cards = current.cards.map(card => card.name && card.imagePath ? card : { ...sampleCards[card.id - 1] });
      for (const player of current.players) {
        const note = privateNotes.current[player.uid as Persona];
        note.target ??= player.uid === "host" ? 1 : 3;
        player.hasTarget = true; player.ready = player.uid !== current.hostUid; player.connected = true; player.disconnectDeadline = null;
      }
      current.status = value === "paused" ? "paused" : "playing";
      current.currentTurnUid = value === "opponent" ? (uid === "host" ? "guest" : "host") : uid;
      if (value === "paused") {
        const other = current.players.find(player => player.uid !== uid)!;
        other.connected = false; other.disconnectDeadline = Date.now() + 60000; setRemaining(60);
      }
    }
    setRoom(current);
  }
  function preparePartner() {
    if (busy || state.status !== "lobby") return;
    const other = uid === "host" ? "guest" : "host";
    privateNotes.current[other].target = 3;
    setRoom(current => ({ ...current, players: current.players.map(player => player.uid === other ? { ...player, hasTarget: true, ready: player.uid !== current.hostUid } : player) }));
    setNotice("展示夥伴已選好目標；非房主的夥伴也已準備");
  }
  function fillSamples() {
    if (busy || !isHost || state.status !== "lobby") return;
    setRoom(current => ({ ...current, cards: current.cards.map(card => card.name && card.imagePath ? card : { ...sampleCards[card.id - 1] }) }));
  }
  function reconnect() {
    setRoom(current => ({ ...current, status: "playing", players: current.players.map(player => ({ ...player, connected: true, disconnectDeadline: null })) }));
    setNotice("展示：已重連，回合、目標與蓋牌保留");
  }
  return { state, uid, isHost, me, busy, loading, error, notice, remaining, startReason, send, scenario, preparePartner, fillSamples, reconnect,
    switchPersona: (next: Persona) => { if (!busy) { setUid(next); setError(""); setNotice(""); } },
    clearError: () => setError("") };
}
