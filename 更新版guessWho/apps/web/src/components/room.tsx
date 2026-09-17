"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CardCount, RetentionPolicy } from "@guesswho/shared/game-types";
import { demoEnabled, useDemoRoom, type Persona, type Scenario } from "@/lib/demo";
import { Brand, Button, Modal, Portrait } from "./ui";
import { CropEditor } from "./crop-editor";
import { useLiveRoom } from "@/lib/live";

const scenarios: { value: Scenario; label: string }[] = [
  { value: "lobby", label: "大廳／重新選目標" }, { value: "playing", label: "遊戲中／我的回合" },
  { value: "opponent", label: "遊戲中／對手回合" },
  { value: "paused", label: "斷線暫停（60 秒）" }, { value: "win", label: "我獲勝／回到大廳" },
  { value: "lose", label: "對手獲勝／回到大廳" }, { value: "loading", label: "載入中的畫面" },
  { value: "error", label: "下一次操作失敗" }, { value: "missing", label: "卡片圖片未完成" },
  { value: "transfer", label: "房主權限移交" },
];
type Props = { roomId: string; count: CardCount; retention: RetentionPolicy; persona: Persona };
export function Room(props: Props) {
  return demoEnabled ? <DemoRoom {...props} /> : <LiveRoom {...props} />;
}
function DemoRoom({ roomId, count, retention, persona }: Props) {
  return <RoomView {...{ roomId, count, retention, persona }} controller={useDemoRoom(roomId, count, retention, persona)} mode="demo" />;
}
function LiveRoom(props: Props) {
  const live = useLiveRoom(props.roomId);
  if (!live.state || !live.me) return <main className="grid min-h-dvh place-content-center gap-5 p-8 text-center"><Brand /><p role={live.error ? "alert" : "status"}>{live.error || "正在登入並讀取房間…"}</p><Link href="/" className="underline">回首頁</Link></main>;
  return <RoomView {...props} controller={live as unknown as Controller} mode="live" />;
}
type Controller = ReturnType<typeof useDemoRoom> & { uploadCardImage?: (cardId: number, dataUrl: string) => Promise<boolean>; leave?: () => Promise<boolean> };
function RoomView({ roomId, count, controller: demo, mode }: Props & { controller: Controller; mode: "demo" | "live" }) {
  const router = useRouter();
  const { state, isHost, me, uid, busy, loading, error, notice, remaining, startReason } = demo;
  const [selected, setSelected] = useState<number | null>(null);
  const [panel, setPanel] = useState<"settings" | "demo" | "target" | "leave" | "rules" | null>(null);
  const [pendingCount, setPendingCount] = useState<CardCount>(count);
  const [confirmGuess, setConfirmGuess] = useState(false);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [dismissedResult, setDismissedResult] = useState<number | null>(null);
  const card = state.cards.find(item => item.id === selected);
  const target = state.cards.find(item => item.id === state.self.targetCardId);
  const folded = selected !== null && state.self.foldedCardIds.includes(selected);
  const myTurn = state.currentTurnUid === uid;
  const lobby = state.status === "lobby";
  const paused = state.status === "paused";
  const canGuess = state.status === "playing" && myTurn;
  const targetLocked = !isHost && me.ready && state.self.targetCardId !== null;
  const result = state.lastResult && state.lastResult.endedAt !== dismissedResult ? state.lastResult : null;
  const other = state.players.find(player => player.uid !== uid) ?? { connected: false, ready: false };
  function closeCard() { setSelected(null); setConfirmGuess(false); setFile(null); setFileError(""); demo.clearError(); }
  function openCard(id: number) { const next = state.cards.find(item => item.id === id)!; setName(next.name); setSelected(id); setConfirmGuess(false); }
  useEffect(() => { if (panel === "settings") setPendingCount(state.cardCount); }, [panel, state.cardCount]);
  useEffect(() => { if (selected !== null && !card) { setSelected(null); setFile(null); } }, [selected, card]);
  useEffect(() => { setSelected(null); setConfirmGuess(false); setFile(null); }, [uid, state.status]);

  const statusText = lobby ? "先選一張，藏好你的秘密。" : paused ? "留一個位置，等朋友回來。" : myTurn ? "輪到你了，問個好問題。" : "仔細觀察，下一個就是你。";
  const playerList = <div className="space-y-3">{state.players.map(player => <div key={player.uid} className="flex items-center gap-3 rounded-xl border border-ink/20 bg-card/70 p-3"><span className={`grid size-10 shrink-0 place-items-center rounded-full border border-ink/40 font-mono font-bold ${player.uid === uid ? "bg-mustard" : "bg-sage/35"}`}>{player.seat}</span><div className="min-w-0 flex-1"><p className="text-sm font-bold">{player.uid === uid ? "你" : "小夥伴"} <span className="text-xs font-normal text-ink/65">{player.uid === state.hostUid ? "房主" : "玩家"}</span></p><p className="mt-1 text-xs text-ink/70">{!player.connected ? "○ 離線中" : !player.hasTarget ? "● 正在選目標" : player.uid === state.hostUid ? "● 已選好目標" : player.ready ? "✓ 已準備" : "● 尚未準備"}</p></div></div>)}</div>;
  const demoControls = <div className="space-y-5">
    <p className="text-xs leading-5 text-ink/65">單機展示，不會連線或保存資料。重新整理會重設。此面板只用於前端驗收。</p>
    <fieldset><legend className="mb-2 text-sm font-bold">目前操作身分</legend><div className="flex gap-2">{(["host", "guest"] as const).map(value => <Button key={value} tone="secondary" disabled={busy} aria-pressed={uid === value} className={uid === value ? "!bg-mustard" : ""} onClick={() => { demo.switchPersona(value); setPanel(null); }}>{value === state.hostUid ? "房主" : "來賓"}（{value === "host" ? "A" : "B"}）</Button>)}</div></fieldset>
    <label className="block text-sm font-bold">展示情境<select value="" disabled={busy} onChange={event => { demo.scenario(event.target.value as Scenario); setPanel(null); }} className="mt-2 w-full text-sm"><option value="" disabled>選擇要驗收的畫面</option>{scenarios.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
    {lobby && <><Button tone="secondary" disabled={busy || loading} onClick={() => { demo.preparePartner(); setPanel(null); }} className="w-full">模擬另一位玩家選好／準備</Button>{isHost && <Button tone="secondary" disabled={busy || loading} onClick={demo.fillSamples} className="w-full">補齊空位的示範卡片</Button>}</>}
    {paused && <Button onClick={() => { demo.reconnect(); setPanel(null); }} className="w-full">模擬重連</Button>}
    <p className="text-xs leading-5 text-ink/60">遊戲情境預設 A 的目標是 01、B 的目標是 03，方便驗收猜中與猜錯；正式版不會提供這份提示。</p>
  </div>;

  return <main className="room-shell flex flex-col overflow-hidden" data-active={!lobby}>
    <header className="flex shrink-0 items-center justify-between gap-2 border-b border-ink/25 px-3 py-2 sm:px-7 sm:py-3">
      <Brand small /><div className="flex items-center gap-2"><span className="hidden font-mono text-xs text-ink/60 sm:inline">ROOM / {roomId}</span>{mode === "demo" ? <button onClick={() => setPanel("demo")} className="min-h-11 cursor-pointer rounded-full border border-orange px-3 text-xs font-bold text-orange">展示工具</button> : <span className="rounded-full border border-sage px-3 py-2 text-xs">● 已連線</span>}<button onClick={() => setPanel("leave")} className="min-h-11 cursor-pointer px-2 text-xs underline underline-offset-4">離開</button></div>
    </header>
    <div className="room-heading shrink-0 px-3 py-3 text-center sm:py-4"><div className="mb-1 flex items-center justify-center gap-2 font-mono text-[10px] tracking-[.18em] text-orange"><span className="size-1.5 rounded-full bg-orange" />{lobby ? "THE WAITING ROOM" : paused ? "A LITTLE INTERMISSION" : "LET THE GUESSING BEGIN"}</div><h1 className="text-lg font-bold sm:text-2xl">{statusText}</h1><p className="room-subtitle mt-1 text-xs text-ink/60">{lobby ? "點擊卡片選擇目標，只有自己看得到。" : "點一下看清楚，再決定蓋牌或指認。"}</p></div>
    <div className="mx-auto grid min-h-0 w-full max-w-[1450px] flex-1 grid-cols-1 gap-5 px-3 lg:grid-cols-[205px_minmax(0,1fr)_205px] lg:px-7">
      <aside className="hidden space-y-5 pt-5 lg:block"><p className="font-mono text-[10px] tracking-widest text-ink/60">AROUND THE TABLE</p>{playerList}<div className="border-t border-ink/25 pt-4 text-sm leading-7"><p className="font-bold">遊戲房 {roomId}</p><p className="text-xs text-ink/60">{state.retentionPolicy === "retain" ? "保留房間 · 密碼進入" : "離開後自動清除"}</p><p className="mt-3 text-xs text-ink/65">一問一答，慢慢排除。<br />勝負之前，先享受好奇。</p></div><button onClick={() => setPanel("rules")} className="min-h-11 cursor-pointer text-sm underline underline-offset-4">翻開遊戲說明 ↗</button></aside>
      <section className="flex min-h-0 min-w-0 flex-col" aria-label="角色棋盤">
        <div className="mb-2 flex shrink-0 items-center justify-between gap-2 text-xs"><span className="font-mono text-ink/65">{state.cardCount} 張角色卡 <span className="ml-1 hidden sm:inline">/ 按編號排列</span></span><div className="flex items-center gap-2">{lobby && isHost ? <button disabled={busy || loading} onClick={() => setPanel("settings")} className="min-h-9 cursor-pointer rounded-md border border-ink/40 px-3">編輯卡組 ↗</button> : <span>{paused ? "暫停中" : lobby ? "可共同編輯角色卡" : `已排除 ${state.self.foldedCardIds.length} 張`}</span>}<span className="lg:hidden">{other.connected ? "●" : "○"} {other.ready ? "對方已準備" : "對方" + (other.connected ? "在線" : "離線")}</span></div></div>
        <div className="board-stage relative flex min-h-0 flex-1 items-center justify-center">
          <div data-testid="board" aria-busy={loading} className={`game-board grid touch-none rounded-xl border-2 border-ink bg-[#ddc8a3] p-[clamp(4px,1.2cqw,12px)] shadow-[4px_4px_0_var(--shadow)] ${state.cardCount === 9 ? "grid-cols-3 grid-rows-3" : state.cardCount === 16 ? "grid-cols-4 grid-rows-4" : "grid-cols-5 grid-rows-5"}`}>
            {state.cards.map(item => {
              const isFolded = state.self.foldedCardIds.includes(item.id);
              const isTarget = state.self.targetCardId === item.id;
              return <button key={item.id} data-card-id={item.id} type="button" disabled={loading} onClick={() => openCard(item.id)} aria-label={`${item.id} 號 ${item.name || "未命名"}${isFolded ? "，已蓋牌" : ""}${isTarget ? "，我的秘密目標" : ""}`} className={`relative aspect-square min-h-0 min-w-0 cursor-pointer overflow-hidden rounded-[clamp(4px,1cqw,10px)] border-2 text-left transition-transform enabled:hover:-translate-y-0.5 ${isTarget ? "border-orange ring-2 ring-orange" : "border-ink/65"} ${isFolded ? "card-fold" : "bg-card"}`}>
                {loading ? <div className="size-full animate-pulse bg-ink/15" /> : isFolded ? <div className="absolute inset-0 flex flex-col items-center justify-center pb-4"><span className="display-font text-[clamp(16px,5cqw,40px)] text-ink/40">?</span><span className="text-[clamp(8px,1.6cqw,12px)] text-ink/70">已蓋牌</span></div> : <Portrait src={item.imagePath} name={`${item.id} 號 ${item.name || "未命名"}`} className="size-full" />}
                <span className="absolute top-0 left-0 rounded-br-md bg-card/95 px-1 font-mono text-[clamp(8px,1.6cqw,12px)]">{String(item.id).padStart(2, "0")}</span>
                {isTarget && <span className="absolute top-0 right-0 bg-orange px-1 text-[clamp(8px,1.6cqw,12px)] text-white" aria-hidden="true">★</span>}
                <span className="absolute inset-x-0 bottom-0 truncate border-t border-ink/25 bg-card/95 px-1 py-0.5 text-center text-[clamp(9px,1.9cqw,15px)] font-bold leading-tight">{item.name || "待編輯"}</span>
              </button>;
            })}
          </div>
          {paused && <div role="status" className="absolute inset-0 flex items-center justify-center rounded-xl bg-paper/85 p-4 text-center"><div><span className="font-mono text-xs tracking-widest">WAITING FOR A FRIEND</span><p className="display-font my-2 text-6xl">{remaining}<span className="ml-1 text-lg">秒</span></p><p className="mb-4 text-sm">對手暫時離線，座位幫他留著。</p>{mode === "demo" && <Button onClick={demo.reconnect}>模擬重連，繼續遊戲</Button>}</div></div>}
        </div>
      </section>
      <aside className="hidden space-y-5 pt-5 lg:block"><p className="font-mono text-[10px] tracking-widest text-ink/60">YOUR LITTLE SECRET</p><div className="rounded-xl border-2 border-dashed border-ink/35 p-5 text-center"><span className="display-font text-5xl text-orange">?</span><p className="mt-3 text-sm font-bold">{target ? "秘密已經藏好了" : "你還沒選目標"}</p><p className="mt-2 text-xs leading-6 text-ink/60">{target ? "需要確認時，再打開看看。" : "點擊一張角色卡，\n選他成為你的秘密。"}</p><Button tone="secondary" disabled={!target} onClick={() => setPanel("target")} className="mt-4 w-full">查看我的目標</Button></div><div className="rounded-lg border border-ink/20 p-4 text-xs leading-6 text-ink/70"><span className="mb-1 block font-bold">小提醒</span>{lobby ? "房主不用準備。另一位玩家準備好後，由房主按開始。" : "蓋牌只是自己的排除筆記，不會用掉本回合的提問機會。"}</div></aside>
    </div>
    <footer className="shrink-0 px-3 pt-3 pb-2 sm:px-7">
      <div className="mx-auto max-w-3xl">
        <div className="mb-2 min-h-4 text-center text-xs" aria-live="polite">{error ? <span role="alert" className="text-danger">{error}</span> : notice || (lobby ? startReason || "條件都滿足了，可以開始！" : paused ? "暫停期間不能進行遊戲操作" : myTurn ? "口頭提問一次，或點卡片指認" : "等待對手行動；你仍可整理自己的蓋牌")}</div>
        <div className="flex items-center justify-center gap-2 sm:gap-4">
          <Button tone="secondary" disabled={!target || loading} onClick={() => setPanel("target")} className="lg:hidden">我的目標</Button>
          {lobby ? isHost ? <Button disabled={busy || loading || !!startReason} onClick={() => demo.send({ type: "game:start", payload: {} })} className="min-w-32 sm:min-w-48">開始遊戲 →</Button> : <Button disabled={busy || loading || (!me.ready && !target)} onClick={() => demo.send({ type: "player:ready", payload: { ready: !me.ready } })} className="min-w-32">{me.ready ? "取消準備" : "我準備好了"}</Button>
            : <Button disabled={busy || loading || paused || !myTurn} onClick={() => demo.send({ type: "turn:question-complete", payload: {} })} className="min-w-32 sm:min-w-48">{paused ? "等待重連" : !myTurn ? "對手的回合" : "已完成提問 ✓"}</Button>}
          <span className="hidden font-mono text-[10px] text-ink/50 sm:block">{busy ? "更新中…" : lobby ? "LOBBY" : paused ? "PAUSED" : "PLAYING"}</span>
        </div>
      </div>
      <p className="mt-2 text-center font-mono text-[9px] tracking-widest text-ink/50">{mode === "demo" ? "前端展示 · 無多人連線／資料保存" : "即時連線 · FIREBASE 保存"} · {roomId}</p>
    </footer>

    {card && <Modal title={confirmGuess ? "最後確認：你要指認他嗎？" : file ? "製作你的角色卡" : `角色卡 NO. ${String(card.id).padStart(2, "0")}`} onClose={closeCard} sheet={!!file}>
      {file ? <CropEditor file={file} onCancel={() => setFile(null)} onSave={async imagePath => { const saved = mode === "live" ? await demo.uploadCardImage?.(card.id, imagePath) : await demo.send({ type: "card:update", payload: { cardId: card.id, imagePath } }); if (saved) setFile(null); else throw new Error("更新失敗"); }} /> : <div className="space-y-4">
        <Portrait src={card.imagePath} name={`${card.id} 號 ${card.name}`} className="card-image mx-auto rounded-xl border-2 border-ink shadow-[4px_4px_0_var(--shadow)]" />
        <h3 className="text-center text-2xl font-bold">{card.name || "還沒有名字"}</h3>
        {confirmGuess ? <><p className="text-center text-sm">確定對方的秘密角色是「{card.name}」？<br />猜錯會直接換對方的回合。</p><div className="flex justify-center gap-3"><Button tone="secondary" onClick={() => setConfirmGuess(false)}>再想一下</Button><Button tone="danger" disabled={!canGuess || busy} onClick={async () => { if (await demo.send({ type: "game:guess", payload: { cardId: card.id } })) closeCard(); }}>確定指認</Button></div></>
          : lobby ? <>
            <Button className="w-full" disabled={busy || targetLocked || !card.imagePath || !card.name} onClick={async () => { if (await demo.send({ type: "target:select", payload: { cardId: card.id } })) closeCard(); }}>{state.self.targetCardId === card.id ? "這是我的秘密目標" : "設為秘密目標"}</Button>
            {targetLocked && <p className="text-center text-xs text-ink/65">請先取消準備，再更換目標。</p>}
            <div className="space-y-3 border-t border-ink/20 pt-4"><label className="block text-xs font-bold">角色名稱<div className="mt-2 flex gap-2"><input aria-label="角色名稱" value={name} maxLength={24} onChange={event => setName(event.target.value)} className="min-w-0 flex-1 text-base" /><Button tone="secondary" disabled={busy || !name.trim()} onClick={() => demo.send({ type: "card:update", payload: { cardId: card.id, name } })}>儲存</Button></div></label><label className="block cursor-pointer rounded-lg border border-dashed border-ink/40 p-3 text-center text-sm">替換圖片（JPEG／PNG／WebP，5 MB 以下）<input type="file" aria-label="替換圖片" accept="image/jpeg,image/png,image/webp" disabled={busy} className="mt-2 block w-full text-xs" onChange={event => { const next = event.target.files?.[0]; event.target.value = ""; setFileError(""); if (!next) return; if (!["image/jpeg", "image/png", "image/webp"].includes(next.type) || next.size > 5 * 1024 * 1024) { setFileError("請選擇 5 MB 以下的 JPEG、PNG 或 WebP 圖片。"); return; } setFile(next); }} /></label></div>
          </> : paused ? <p className="text-center text-sm">等待玩家重連，剩餘 {remaining} 秒</p> : <><div className="flex justify-center gap-3"><Button tone="secondary" disabled={busy} onClick={async () => { if (await demo.send({ type: "card:fold-toggle", payload: { cardId: card.id } })) closeCard(); }}>{folded ? "翻回這張牌" : "蓋牌"}</Button>{canGuess && <Button tone="danger" disabled={busy} onClick={() => setConfirmGuess(true)}>指認這個人</Button>}</div>{!canGuess && <p className="text-center text-xs text-ink/65">現在不是你的回合，只能蓋牌或翻回。</p>}</>}
        {(error || fileError) && <p role="alert" className="text-center text-sm text-danger">{error || fileError}</p>}
      </div>}
    </Modal>}
    {panel === "target" && <Modal title="只有你知道的小秘密" onClose={() => setPanel(null)}>{target ? <><Portrait src={target.imagePath} name={target.name} className="card-image mx-auto rounded-xl border-2 border-ink" /><p className="mt-4 text-center text-xl font-bold">{String(target.id).padStart(2, "0")} · {target.name}</p><p className="mt-2 text-center text-xs text-ink/60">回答問題時，以這張角色卡為準。</p></> : <p>尚未選擇秘密目標。</p>}</Modal>}
    {panel === "settings" && <Modal title="整理這一局的卡組" onClose={() => { if (!busy) setPanel(null); }}><div className="space-y-5">
      <p className="text-sm">目前 {state.cardCount} 張。選好新數量後，按確認才會變更。</p>
      <div className="grid grid-cols-3 gap-3">{([9, 16, 25] as const).map(value => <Button tone="secondary" key={value} disabled={busy} aria-pressed={value === pendingCount} className={value === pendingCount ? "!bg-mustard" : ""} onClick={() => setPendingCount(value)}>{value} 張</Button>)}</div>
      <p aria-live="polite" className="rounded-lg bg-paper p-3 text-sm leading-6">{pendingCount < state.cardCount ? `確認後只保留 1～${pendingCount} 號，移除 ${pendingCount + 1}～${state.cardCount} 號卡片與圖片；選到被移除卡片的玩家需要重選目標。` : pendingCount > state.cardCount ? `確認後新增 ${state.cardCount + 1}～${pendingCount} 號空位，補齊名稱與圖片後才能開始。` : "尚未變更數量。房主可以在大廳修改，開始後鎖定。"}</p>
      <div className="flex justify-end gap-3"><Button tone="secondary" disabled={busy} onClick={() => setPanel(null)}>取消</Button><Button disabled={busy || pendingCount === state.cardCount} onClick={async () => { if (await demo.send({ type: "room:update-settings", payload: { cardCount: pendingCount } })) setPanel(null); }}>{busy ? "套用中…" : "確認變更"}</Button></div>
      <p className="text-xs leading-6 text-ink/65">既有準備狀態保持不變。取消或關閉視窗不會套用選擇。</p>
      {mode === "demo" && <Button tone="secondary" className="w-full" disabled={busy || pendingCount !== state.cardCount} onClick={demo.fillSamples}>用示範卡片補齊空位</Button>}
      {error && <p role="alert" className="text-danger">{error}</p>}
    </div></Modal>}
    {panel === "demo" && mode === "demo" && <Modal title="前端驗收工具" onClose={() => setPanel(null)}>{playerList}<div className="mt-5">{demoControls}</div></Modal>}
    {panel === "rules" && <Modal title="一問一答，找到那個人" onClose={() => setPanel(null)}><p className="text-sm leading-8">每回合選擇口頭提問或指認。提問完按「已完成提問」就會直接換對方；猜錯也會自動換回合，猜中獲勝。蓋牌是你自己的排除筆記，不消耗回合，也能隨時翻回。</p></Modal>}
    {panel === "leave" && <Modal title={lobby ? "要先離開這張遊戲桌嗎？" : "確定離開這一局？"} onClose={() => setPanel(null)}><p className="mb-5 text-sm leading-7">{mode === "demo" ? (lobby ? "展示資料不會保存，回來時將重新開始。" : "正式遊戲主動離開會立即判負。這個展示房間離開後會重設。") : (lobby ? "離開後會立即釋放座位。" : "遊戲中主動離開會立即判負。")}</p><div className="flex justify-end gap-3"><Button tone="secondary" onClick={() => setPanel(null)}>繼續留著</Button>{mode === "demo" ? <Link href="/" className="inline-flex min-h-11 items-center rounded-lg border-2 border-ink bg-danger px-4 text-sm font-bold text-white">確認離開</Link> : <Button tone="danger" disabled={busy} onClick={async () => { if (await demo.leave?.()) router.push("/"); }}>確認離開</Button>}</div></Modal>}
    {result && !panel && <Modal title="這一局，揭曉了。" onClose={() => setDismissedResult(result.endedAt)}><div className="py-4 text-center"><span className="display-font text-7xl text-orange">{result.winnerUid === uid ? "Bravo!" : "Nice try!"}</span><h2 className="mt-5 text-2xl font-bold">{result.winnerUid === uid ? "恭喜你，猜謎小偵探。" : "好對手，下局再挑戰。"}</h2><p className="mt-3 text-sm text-ink/65">{result.reason === "disconnect_forfeit" ? "對手斷線逾時，本局結束。" : "秘密揭曉，這一局已結束。"}<br />卡組已保留，重新選目標就能再來一局。</p><Button className="mt-6" onClick={() => setDismissedResult(result.endedAt)}>回到大廳 →</Button></div></Modal>}
  </main>;
}
