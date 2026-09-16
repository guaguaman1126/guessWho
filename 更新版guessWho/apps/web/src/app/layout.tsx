import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "GuessWho・猜猜我是誰", description: "一張秘密角色卡，一場充滿好奇的雙人桌遊。", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f4e8d1" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}
