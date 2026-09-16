"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { deleteObject, ref, uploadBytes } from "firebase/storage";
import type { Acknowledgment, RoomState } from "@guesswho/shared/game-types";
import type { GameCommand } from "@guesswho/shared/socket-events";
import { authenticatedSocket, getFirebase, imageUrl, roomPasswordKey } from "./firebase-client";

type LooseSocket = {
  connected: boolean;
  emit(event: string, payload: unknown, ack: (result: Acknowledgment) => void): void;
  disconnect(): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
};

export function useLiveRoom(roomId: string) {
  const [state, setState] = useState<RoomState | null>(null);
  const [uid, setUid] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [remaining, setRemaining] = useState(60);
  const socketRef = useRef<LooseSocket | null>(null);

  useEffect(() => {
    let active = true;
    void authenticatedSocket().then(socket => {
      if (!active) { socket.disconnect(); return; }
      const loose = socket as unknown as LooseSocket;
      socketRef.current = loose;
      loose.on("connect_error", (cause: unknown) => { setError(cause instanceof Error ? cause.message : "連線失敗"); setLoading(false); });
      socket.on("room:error", message => setError(message));
      socket.on("room:state", async next => {
        const cards = await Promise.all(next.cards.map(async card => ({ ...card, imagePath: await imageUrl(card.imagePath).catch(() => "") })));
        if (!active) return;
        setUid(next.self.uid); setState({ ...next, cards }); setLoading(false); setError("");
      });
      const join = () => loose.emit("room:join", { roomId, password: sessionStorage.getItem(roomPasswordKey(roomId)) ?? undefined }, result => {
        if (!result.ok) { setError(result.error); setLoading(false); }
      });
      if (loose.connected) join(); else loose.on("connect", join);
    }).catch(cause => { setError(cause instanceof Error ? cause.message : "無法登入"); setLoading(false); });
    return () => { active = false; socketRef.current?.disconnect(); socketRef.current = null; };
  }, [roomId]);

  useEffect(() => {
    const deadline = state?.players.find(player => !player.connected)?.disconnectDeadline;
    if (!deadline) { setRemaining(60); return; }
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer);
  }, [state]);

  async function send(command: GameCommand): Promise<boolean> {
    const socket = socketRef.current;
    if (!socket?.connected || busy) { setError("目前尚未連上遊戲伺服器"); return false; }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await new Promise<Acknowledgment>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("伺服器回應逾時，請再試一次")), 10_000);
        socket.emit(command.type, command.payload, ack => { clearTimeout(timer); resolve(ack); });
      });
      if (!result.ok) throw new Error(result.error);
      setNotice("已同步保存"); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失敗"); return false; }
    finally { setBusy(false); }
  }

  async function uploadCardImage(cardId: number, dataUrl: string): Promise<boolean> {
    const blob = await fetch(dataUrl).then(response => response.blob());
    const path = `rooms/${roomId}/cards/${cardId}/${crypto.randomUUID()}.jpg`;
    const object = ref(getFirebase().storage, path);
    setBusy(true); setError("");
    try {
      await uploadBytes(object, blob, { contentType: "image/jpeg" });
      setBusy(false);
      if (await send({ type: "card:update", payload: { cardId, imagePath: path } })) return true;
      await deleteObject(object).catch(() => undefined);
      return false;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "圖片上傳失敗"); return false; }
    finally { setBusy(false); }
  }

  async function leave(): Promise<boolean> {
    return send({ type: "room:leave", payload: {} });
  }

  const me = state?.players.find(player => player.uid === uid) ?? null;
  const isHost = Boolean(state && uid === state.hostUid);
  const startReason = useMemo(() => {
    if (!state) return "正在讀取房間";
    if (state.players.length !== 2 || state.players.some(player => !player.connected)) return "等待兩位玩家都上線";
    if (state.cards.some(card => !card.name.trim() || !card.imagePath)) return "請先補齊所有卡片的名稱與圖片";
    if (state.players.some(player => !player.hasTarget)) return "雙方都要先選好秘密目標";
    if (!state.players.find(player => player.uid !== state.hostUid)?.ready) return "等待另一位玩家按下準備";
    return "";
  }, [state]);

  return { state, uid, isHost, me, busy, loading, error, notice, remaining, startReason, send, uploadCardImage, leave, clearError: () => setError("") };
}
