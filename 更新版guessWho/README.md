# GuessWho 前端體驗版

目前完成第一、二階段：npm workspace 架構、必要依賴、Server 健康檢查、共用型別及可操作的前端展示。**停在人工驗收點，尚未進入第三階段。**

## 啟動

使用 Node.js 22 以上（本次以 Node.js 24.13.0 驗證）。在 PowerShell 執行：

```powershell
cd "C:\Users\n1270\Documents\GitHub\guessWho\更新版guessWho"
npm ci
npm run dev
```

第一次安裝使用 `npm ci`；本次已安裝完成，現在只需 `npm run dev`。開啟 http://localhost:3000 。前端展示不需要 Firebase 設定或 Server。

手機／平板與電腦連接相同區域網路時，可開啟 Next.js 啟動訊息中的 Network 網址；若無法連入，先確認 Windows 防火牆是否允許此本地開發服務。

獨立 Server 骨架可另外啟動：

```powershell
npm run dev:server
```

健康檢查：http://localhost:4000/health 。回傳 `gameReady: false` 是預期結果；此 Server 尚未連接 Firebase 或處理遊戲事件。

## 如何驗收

1. 首頁選「開一間遊戲房」，選擇 9／16／25 張及是否保留房間，進入展示大廳。
2. 點角色卡，再按「設為秘密目標」。房主不需要準備。
3. 右上角「展示工具」可切換 A／B 身分，或模擬另一位玩家選好目標並準備。
4. 回到房主身分，按「開始遊戲」。點卡片可放大、蓋牌、翻回或二次確認指認。
5. 完成口頭提問後，按「已完成提問」再「結束回合」。也可用展示工具切換到對方回合、暫停、勝負、載入及操作失敗情境。
6. 在大廳選擇卡片數量後，按「確認變更」才會套用；取消或關閉不改卡組。檢查 25 → 9 只保留前九張。增加卡片時會出現空位，房主可上傳圖片／改名，或使用「用示範卡片補齊空位」。
7. 卡片編輯可選取 JPEG／PNG／WebP（最大 5 MB），用滑鼠或手指拖曳取景，以雙指／滾輪／滑桿縮放，再產生 600 × 600 JPEG 本地預覽。裁切框固定正方形，也可重設位置與縮放。
8. 加入展示房可使用 `DEMO01`；密碼房為 `KEEP01`，展示密碼為 `1234`。其他房號會顯示錯誤。創建時輸入的密碼只展示表單，不保存或寫入網址。

遊戲情境會補入 A 的示範目標 01、B 的示範目標 03，方便檢查猜中與猜錯。切換身分可檢查各自的目標及蓋牌筆記；畫面接收的 `RoomState` 只含目前身分的私人資料。

## 目前的界線

- 所有展示狀態只存在目前頁面記憶體，重新整理／離開會重設，不提供真正的多人同步。
- 「保留房間」、密碼驗證、對手、倒數、權限及重連都是展示情境，不是正式後端功能。
- 圖片裁切是真的；上傳 Storage、Firestore 寫入、Firebase 匿名登入及 Socket.IO 連線尚未接上。
- 不會執行房間刪除、30 天清理、排程或雲端部署。
- `npm run dev` 自動啟用展示；正式 `npm run build` 預設關閉展示操作，顯示服務尚未開放。若要驗收最佳化的展示版本，僅在本地建置前設定 `NEXT_PUBLIC_DEMO_MODE=true`，不要用於正式遊戲部署。
- 五種尺寸以桌面瀏覽器的 viewport 模擬檢查。實體 iPhone／iPad 的網址列、安全區域、捏合手勢與軟鍵盤，仍請在人工驗收時確認。
- `npm audit` 目前回報 2 項 moderate 間接相依提示，來源是 `firebase-admin → @google-cloud/storage → gaxios 6 → uuid 9`。已使用目前的 `firebase-admin 14.4.0`，相容性的 `npm audit fix` 仍無法更新這條舊相依；第三階段啟用 Firebase Admin 前再確認上游版本，不強制覆寫其相依套件。

## 檔案位置

| 路徑 | 用途 |
|---|---|
| `apps/web/src/components/home.tsx` | 首頁、建立／加入房間表單、規則 |
| `apps/web/src/components/room.tsx` | 棋盤、大廳、回合操作、放大視窗與展示工具 |
| `apps/web/src/components/crop-editor.tsx` | Canvas 正方形裁切與 JPEG 預覽 |
| `apps/web/src/components/ui.tsx` | 按鈕、原生 dialog、圖片載入與錯誤狀態 |
| `apps/web/src/lib/demo.ts` | 唯一的展示資料入口，下一階段替換為真實傳輸 |
| `apps/web/src/app/globals.css` | Tailwind、Retro 色彩、字體與觸控規則 |
| `apps/web/public/assets/characters/` | 25 張本專案原創 SVG 角色插畫，無外部圖片請求 |
| `apps/game-server/src/server.ts` | 僅健康檢查的 Express 骨架 |
| `packages/shared/` | 房間安全狀態與 Socket 事件共用型別 |
| `scripts/check-preview.mjs` | 使用既有 Playwright 的瀏覽器驗證脚本 |

Firebase 規則與正式 Server 模組於第三階段才建立，避免把空架構誤認為已完成。

## 驗證指令

```powershell
npm run typecheck
npm run build
```

瀏覽器驗證需先啟動前端，再使用已安裝的 Playwright：

```powershell
node scripts/check-preview.mjs "<Playwright 套件的絕對路徑>"
```

此腳本使用本機 Edge，不會把瀏覽器測試工具加入產品依賴。截圖輸出於被 Git 忽略的 `artifacts/`。

版面檢查涵蓋 320 × 568、390 × 844、768 × 1024、1024 × 768、1440 × 900；每個尺寸檢查 9／16／25 張卡片的大廳與遊戲狀態。互動檢查涵蓋身分權限、準備、縮減卡組、提問、指認、蓋牌、重連、賽後結果、裁切、操作失敗重試及密碼房表單。

實作參考：[Next.js 安裝文件](https://nextjs.org/docs/app/getting-started/installation)、[Tailwind 的 Next.js 設定](https://tailwindcss.com/docs/installation/framework-guides/nextjs)。安裝版本由根目錄 `package-lock.json` 固定。

## 人工驗收點

請先確認版面、圖片大小、操作流程與美術風格。只有使用者明確確認前端並同意開始後端後，才能進入第三階段。
