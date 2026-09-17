"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Brand, Button, Modal, Portrait } from "./ui";
import { demoEnabled, sampleCards } from "@/lib/demo";
import { authenticatedSocket, firebaseConfigured, roomPasswordKey } from "@/lib/firebase-client";
import type { Acknowledgment, CardCount } from "@guesswho/shared/game-types";

export function Home() {
  const router = useRouter();
  const [panel, setPanel] = useState<"create" | "join" | "rules" | null>(null);
  const [count, setCount] = useState<CardCount>(16);
  const [retain, setRetain] = useState(false);
  const [password, setPassword] = useState("");
  const [roomId, setRoomId] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  function open(value: typeof panel) { setPanel(value); setPassword(""); setError(""); setNeedsPassword(false); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (panel === "create" && retain && !password.trim()) { setError("保留房間請先設定通關密碼。"); return; }
    if (demoEnabled && panel === "create") {
      // 密碼只用來展示表單，不存到網址或瀏覽器儲存區。
      router.push(`/room/DEMO01?count=${count}&retain=${retain ? 1 : 0}`);
    } else if (demoEnabled) {
      if (roomId.toUpperCase() !== "DEMO01" && roomId.toUpperCase() !== "KEEP01") { setError("找不到展示房間。請輸入 DEMO01 或 KEEP01。"); return; }
      if (roomId.toUpperCase() === "KEEP01") {
        if (!needsPassword) { setNeedsPassword(true); return; }
        if (password !== "1234") { setError("通關密碼不正確，請再試一次。"); return; }
      }
      router.push(`/room/${roomId.toUpperCase()}?role=guest&retain=${needsPassword ? 1 : 0}`);
    } else {
      if (!firebaseConfigured()) { setError("尚未設定 Firebase，請依 README 完成環境設定。"); return; }
      setBusy(true);
      try {
        const socket = await authenticatedSocket();
        const result = await new Promise<Acknowledgment>((resolve, reject) => {
          const timer = setTimeout(() => { socket.disconnect(); reject(new Error("伺服器回應逾時")); }, 10_000);
          const send = () => {
            const done = (ack: Acknowledgment) => { clearTimeout(timer); socket.disconnect(); resolve(ack); };
            if (panel === "create") socket.emit("room:create", { cardCount: count, retentionPolicy: retain ? "retain" : "delete_when_empty", password: retain ? password : undefined }, done);
            else socket.emit("room:join", { roomId: roomId.toUpperCase(), password: password || undefined }, done);
          };
          if (socket.connected) send(); else socket.once("connect", send);
          socket.once("connect_error", cause => { clearTimeout(timer); reject(cause); });
        });
        if (!result.ok) {
          if (panel === "join" && result.error.includes("密碼") && !needsPassword) setNeedsPassword(true);
          throw new Error(result.error);
        }
        const nextRoomId = result.roomId!;
        if (password) sessionStorage.setItem(roomPasswordKey(nextRoomId), password);
        router.push(`/room/${nextRoomId}`);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失敗"); }
      finally { setBusy(false); }
    }
  }
  return <main className="mx-auto min-h-dvh max-w-7xl px-5 sm:px-10">
    <header className="flex min-h-22 items-center justify-between gap-4 border-b border-ink/25 py-4">
      <Brand /><button onClick={() => open("rules")} className="min-h-11 cursor-pointer text-sm underline decoration-ink/30 underline-offset-4">遊戲怎麼玩 ↗</button>
    </header>
    <div className="mt-5 flex items-center gap-2 font-mono text-[11px] tracking-widest text-ink/65"><span className="size-2 rounded-full bg-orange" />{demoEnabled ? "前端體驗版 · 不會連線或保存資料" : "即時雙人連線版"}</div>
    <section className="grid items-center gap-10 py-10 sm:py-16 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
      <div>
        <p className="mb-5 font-mono text-xs tracking-[.25em] text-orange">A LITTLE MYSTERY. A LOT OF FUN.</p>
        <h1 className="display-font text-[clamp(44px,6vw,80px)] leading-[1.13] tracking-tight">你的線索，<br />我的<span className="relative text-orange">秘密。<svg aria-hidden="true" viewBox="0 0 260 18" className="absolute -bottom-2 left-0 w-full"><path d="M3 12Q105-2 254 7" fill="none" stroke="currentColor" strokeWidth="5" /></svg></span></h1>
        <p className="mt-8 max-w-sm text-base leading-8 text-ink/75">戴眼鏡？留著鬍子？<br />一問一答，把可能慢慢縮小。<br />找一位朋友，猜猜彼此心裡的那個人。</p>
        <div className="mt-8 flex flex-wrap gap-3 font-mono text-xs"><span className="rounded-full border border-ink/35 px-3 py-2">2 人一起玩</span><span className="rounded-full border border-ink/35 px-3 py-2">9・16・25 張角色卡</span></div>
      </div>
      <div className="relative mx-auto w-full max-w-lg">
        <div className="absolute -top-4 -right-2 z-10 grid size-24 rotate-12 place-content-center rounded-full border-2 border-ink bg-mustard text-center text-sm font-bold shadow-[3px_3px_0_var(--shadow)]">一張卡片<br /><span className="display-font text-xl">無限好奇</span></div>
        <div className="rotate-[-3deg] rounded-2xl border-2 border-ink bg-sage p-5 shadow-[9px_9px_0_var(--shadow)] sm:p-7">
          <div className="mb-4 flex items-center justify-between text-paper"><span className="display-font text-xl">THE USUAL SUSPECTS</span><span className="font-mono text-xs">NO. 001</span></div>
          <div className="grid grid-cols-3 gap-3">{sampleCards.slice(0, 9).map((card, index) => <div key={card.id} className={`overflow-hidden rounded-lg border-2 border-ink bg-card ${index === 4 ? "rotate-6 shadow-[4px_4px_0_var(--ink)]" : ""}`}><Portrait src={card.imagePath} name={card.name} className="aspect-square" /><div className="py-1 text-center text-xs font-bold">{card.name}</div></div>)}</div>
          <p className="mt-4 text-center font-mono text-[10px] tracking-[.25em] text-paper">LOOK CLOSELY. ASK CURIOUSLY.</p>
        </div>
      </div>
    </section>
    <section className="grid gap-4 pb-10 md:grid-cols-2">
      <button onClick={() => open("create")} className="group flex cursor-pointer items-center justify-between gap-4 rounded-xl border-2 border-ink bg-orange p-6 text-left text-paper shadow-[5px_5px_0_var(--shadow)] transition-transform hover:-translate-y-1"><div><span className="font-mono text-[10px] tracking-widest">START YOUR OWN TABLE</span><h2 className="mt-2 text-2xl font-bold">開一間遊戲房</h2><p className="mt-2 text-sm">選好卡組，邀請朋友來坐坐。</p></div><span className="text-4xl transition-transform group-hover:translate-x-1">↗</span></button>
      <button onClick={() => open("join")} className="group flex cursor-pointer items-center justify-between gap-4 rounded-xl border-2 border-ink bg-card p-6 text-left shadow-[5px_5px_0_var(--shadow)] transition-transform hover:-translate-y-1"><div><span className="font-mono text-[10px] tracking-widest text-ink/60">A SEAT IS WAITING FOR YOU</span><h2 className="mt-2 text-2xl font-bold">加入朋友的房間</h2><p className="mt-2 text-sm text-ink/70">帶著房號，和一點點好奇心。</p></div><span className="text-4xl transition-transform group-hover:translate-x-1">↗</span></button>
    </section>
    <footer className="flex flex-wrap justify-between gap-3 border-t border-ink/25 py-5 text-xs text-ink/60"><span>GUESSWHO — 給面對面的好時光。</span><span>本地插畫卡組 · FRONTEND PREVIEW 01</span></footer>
    {panel && <Modal title={panel === "create" ? "準備一張屬於你的遊戲桌" : panel === "join" ? "你的座位準備好了" : "一本很短的遊戲說明書"} onClose={() => open(null)}>
      {panel === "rules" ? <div className="space-y-5 text-sm leading-7">
        {["選一張秘密角色卡，不讓對方知道。房主選好後，等待朋友準備再開始。", "輪到你時，口頭問一個問題，或直接指認角色。問答結束後按「已完成提問」，就會直接換對方。", "隨時蓋住已排除的卡片，也可以翻回。這些是你自己的筆記。", "指認猜錯會自動換回合；猜中就獲勝。下一局沿用卡組，重新選目標。"].map((text, i) => <p key={text}><span className="mr-3 font-mono text-orange">0{i + 1}</span>{text}</p>)}
        <p className="rounded-lg bg-paper p-3 text-xs">{demoEnabled ? "這是單機前端展示。房間加入、夥伴與連線狀態都是模擬；重新整理會重設。" : "正式版使用匿名登入識別座位，並由伺服器同步回合與保存資料。"}</p>
      </div> : <form onSubmit={submit} className="space-y-5">
        {panel === "create" ? <>
          <fieldset><legend className="mb-3 text-sm font-bold">這次要猜幾張卡片？</legend><div className="grid grid-cols-3 gap-3">{([9, 16, 25] as const).map(value => <button type="button" key={value} aria-pressed={count === value} onClick={() => setCount(value)} className={`cursor-pointer rounded-lg border-2 p-3 text-center ${count === value ? "border-ink bg-mustard" : "border-ink/25"}`}><span className="display-font block text-3xl">{value}</span><span className="text-xs">{value === 9 ? "輕鬆暖身" : value === 16 ? "剛剛好的挑戰" : "偵探的最愛"}</span></button>)}</div></fieldset>
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={retain} onChange={event => setRetain(event.target.checked)} className="size-5 accent-orange" /><span className="text-sm">離開後保留房間與圖片</span></label>
          <p className="text-xs leading-5 text-ink/65">{retain ? "正式版需房號＋密碼重新進入，30 天無人進入後刪除。" : "預設在所有人離開、重連寬限結束後刪除房間與圖片。"}</p>
        </> : <><label className="block text-sm font-bold">房間號碼<input autoFocus value={roomId} onChange={event => { setRoomId(event.target.value.toUpperCase()); setNeedsPassword(false); setPassword(""); }} placeholder={demoEnabled ? "例如 DEMO01" : "例如 A1B2C3"} maxLength={12} required className="mt-2 w-full font-mono uppercase" /></label>{demoEnabled && <p className="text-xs text-ink/65">展示房號：DEMO01。密碼房：KEEP01（密碼 1234）。</p>}</>}
        {(panel === "create" && retain || needsPassword) && <label className="block text-sm font-bold">房間通關密碼<input type="password" autoComplete="off" value={password} onChange={event => setPassword(event.target.value)} required maxLength={64} className="mt-2 w-full" /><span className="mt-2 block text-xs font-normal text-ink/65">請勿使用個人帳號的常用密碼。{demoEnabled ? "展示版不保存密碼。" : "此小遊戲會直接把密碼保存於房間秘密資料。"}</span></label>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full">{busy ? "連線中…" : panel === "create" ? (demoEnabled ? "創建展示房間 →" : "創建房間 →") : needsPassword ? "驗證密碼並加入 →" : (demoEnabled ? "加入展示房間 →" : "加入房間 →")}</Button>
      </form>}
    </Modal>}
  </main>;
}
