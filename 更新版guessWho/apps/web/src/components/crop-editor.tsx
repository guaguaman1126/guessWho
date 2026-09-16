"use client";
import { useEffect, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import "react-easy-crop/react-easy-crop.css";
import { Button } from "./ui";

// 手勢交給 react-easy-crop；Canvas 只負責將選取範圍輸出成 JPEG。
export function CropEditor({ file, onCancel, onSave }: { file: File; onCancel: () => void; onSave: (url: string) => Promise<void> }) {
  const bitmap = useRef<HTMLImageElement | null>(null);
  const [source, setSource] = useState("");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [area, setArea] = useState<Area | null>(null);
  const [zoom, setZoom] = useState(1);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setReady(false); setArea(null); setError(""); setCrop({ x: 0, y: 0 }); setZoom(1);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { bitmap.current = img; setSource(url); setReady(true); };
    img.onerror = () => setError("無法讀取圖片，請使用 JPEG、PNG 或 WebP。");
    img.src = url;
    return () => { img.onload = null; img.onerror = null; URL.revokeObjectURL(url); };
  }, [file]);
  return <div className="space-y-4">
    <p id="crop-instructions" className="text-sm text-ink/70">拖曳移動圖片，雙指或滾輪縮放。方框內就是最後的角色卡。</p>
    <div data-testid="crop-area" className="relative mx-auto aspect-square w-[min(100%,46dvh)] touch-none overflow-hidden rounded-xl border-2 border-ink bg-ink">
      {ready && source && <Cropper image={source} crop={crop} zoom={zoom} aspect={1} minZoom={1} maxZoom={3}
        onCropChange={setCrop} onZoomChange={setZoom} onCropAreaChange={(_, pixels) => setArea(pixels)}
        objectFit="contain" disableAutomaticStylesInjection
        cropperProps={{ "aria-label": "圖片裁切區，使用方向鍵移動圖片", "aria-describedby": "crop-instructions" }}
        mediaProps={{ draggable: false, alt: "待裁切圖片" }}
        style={{ cropAreaStyle: { border: "2px solid #fff3e0" } }}
        onTouchRequest={() => !saving} onWheelRequest={() => !saving} />}
      {!ready && !error && <p className="absolute inset-0 grid place-items-center text-sm text-paper">載入圖片中…</p>}
      {saving && <div className="absolute inset-0 z-10 cursor-wait bg-paper/30" />}
    </div>
    <label className="flex min-h-11 items-center gap-3 text-sm"><span className="w-12 shrink-0">縮放</span><input type="range" aria-label="縮放" min={1} max={3} step={0.05} value={zoom} disabled={saving} onChange={event => setZoom(Number(event.target.value))} className="w-full accent-orange" /><output className="w-12 shrink-0 font-mono text-xs">{zoom.toFixed(1)}×</output></label>
    <button type="button" disabled={saving} onClick={() => { setCrop({ x: 0, y: 0 }); setZoom(1); }} className="min-h-11 cursor-pointer text-xs underline underline-offset-4">重設位置與縮放</button>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <div className="flex justify-end gap-3"><Button tone="secondary" onClick={onCancel} disabled={saving}>取消裁切</Button><Button disabled={!ready || !area || saving} onClick={async () => {
      setSaving(true);
      try {
        if (!bitmap.current || !area) return;
        const canvas = document.createElement("canvas");
        canvas.width = 600; canvas.height = 600;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas unavailable");
        context.fillStyle = "#fff3e0"; context.fillRect(0, 0, 600, 600);
        context.drawImage(bitmap.current, area.x, area.y, area.width, area.height, 0, 0, 600, 600);
        await onSave(canvas.toDataURL("image/jpeg", 0.85));
      }
      catch { setError("圖片更新失敗，請重試。"); }
      finally { setSaving(false); }
    }}>{saving ? "處理中…" : "套用圖片"}</Button></div>
    <p className="text-xs text-ink/60">僅本地預覽，不會上傳。支援 JPEG／PNG／WebP，最大 5 MB。</p>
  </div>;
}
