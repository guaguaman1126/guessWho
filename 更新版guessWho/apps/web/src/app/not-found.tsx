import Link from "next/link";
export default function NotFound() { return <main className="grid min-h-dvh place-content-center gap-5 p-8 text-center"><h1 className="display-font text-5xl">迷路了嗎？</h1><p>這個展示頁面不存在。</p><Link href="/" className="underline">回到首頁</Link></main>; }
