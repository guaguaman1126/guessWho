"use client";

import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";

export function Button({ children, tone = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "secondary" | "danger" }) {
  const colors = { primary: "bg-ink text-paper", secondary: "bg-card text-ink", danger: "bg-danger text-white" };
  return <button {...props} className={`min-h-11 rounded-lg border-2 border-ink px-4 py-2 text-sm font-bold transition-[transform,box-shadow] enabled:cursor-pointer enabled:shadow-[3px_3px_0_var(--shadow)] enabled:hover:-translate-y-0.5 enabled:active:translate-y-0.5 enabled:active:shadow-none disabled:cursor-not-allowed disabled:opacity-45 ${colors[tone]} ${className}`}>{children}</button>;
}

export function Brand({ small = false }: { small?: boolean }) {
  return <Link href="/" aria-label="GuessWho 回首頁" className={`display-font inline-flex items-center gap-2 tracking-tight ${small ? "text-xl" : "text-2xl"}`}><span className="inline-grid size-8 rotate-[-8deg] place-items-center rounded-lg border-2 border-ink bg-orange text-paper">?</span>guess<span className="-ml-2 text-orange">who</span><span className="text-orange">.</span></Link>;
}

export function Modal({ title, children, onClose, wide = false, sheet = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; sheet?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { dialog.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog ref={ref} aria-labelledby={id} onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    className={`m-auto max-h-[94dvh] w-[calc(100%-24px)] overflow-y-auto rounded-2xl border-2 border-ink bg-card p-4 text-ink shadow-[8px_8px_0_#3e272355] backdrop:bg-[#2c201bc9] sm:p-6 ${wide ? "max-w-2xl" : "max-w-lg"} ${sheet ? "max-sm:mb-0 max-sm:max-h-[96dvh] max-sm:rounded-b-none" : ""}`}>
    <div className="mb-4 flex items-center justify-between gap-4"><h2 id={id} className="font-bold">{title}</h2><button type="button" onClick={onClose} aria-label="關閉視窗" className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border border-ink/30 text-xl hover:bg-paper">×</button></div>
    {children}
  </dialog>;
}

export function Portrait({ src, name, className = "" }: { src: string; name: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setFailed(false); setLoaded(false); }, [src]);
  return <div className={`relative overflow-hidden bg-paper ${className}`}>
    {!loaded && src && !failed && <span className="absolute inset-0 animate-pulse bg-ink/10" />}
    {src && !failed ? <img src={src} alt={name} draggable={false} onDragStart={event => event.preventDefault()} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} className="size-full object-cover" /> : <div role="img" aria-label={name + "，圖片未完成"} className="flex size-full flex-col items-center justify-center gap-1 text-ink/60"><span className="display-font text-3xl">?</span><span className="text-[10px]">{failed ? "圖片載入失敗" : "等待圖片"}</span></div>}
  </div>;
}
