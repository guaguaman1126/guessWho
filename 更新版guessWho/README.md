# GuessWho 三層式重製版

第三、四階段已完成：Next.js 前端、獨立 Socket.IO Game Server、Firebase Authentication／Firestore／Storage、權限規則、斷線恢復、清理工作與本機整合驗證均已接線。雲端設定已準備，但尚未替任何 Firebase／Google Cloud／Vercel 帳號部署。

## 架構

```text
Browser
├─ Next.js／React／TypeScript／Tailwind CSS
├─ Firebase Anonymous Auth ＋ Storage
└─ Socket.IO
   └─ Node.js／Express Game Server
      └─ Firebase Admin SDK → Firestore／Storage
```

Game Server 是唯一裁判，Firestore 是永久狀態來源。Web Client 不能直接讀寫 Firestore；每位玩家收到的 `room:state` 只含自己的秘密目標與蓋牌。

## 一般前端展示

不啟動 Firebase 或 Game Server 也能看已驗收的單機展示：

```powershell
cd "C:\Users\n1270\Documents\GitHub\guessWho\更新版guessWho"
npm ci
npm run dev
```

若沒有建立 `apps/web/.env.local`，開發模式預設使用展示資料。開啟 http://localhost:3000 。展示房號是 `DEMO01`；密碼房是 `KEEP01`，密碼為 `1234`。

## 本機正式多人模式

需要三個 PowerShell 視窗。

第一次先複製前端 Emulator 設定：

```powershell
Copy-Item "apps/web/.env.local.example" "apps/web/.env.local"
```

視窗一，啟動 Firebase Emulator：

```powershell
npm run emulators
```

視窗二，讓 Firebase Admin SDK 連到 Emulator，再啟動 Game Server：

```powershell
$env:FIREBASE_PROJECT_ID="demo-guesswho"
$env:FIREBASE_STORAGE_BUCKET="demo-guesswho.firebasestorage.app"
$env:FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"
$env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"
$env:FIREBASE_STORAGE_EMULATOR_HOST="127.0.0.1:9199"
$env:WEB_ORIGIN="http://localhost:3000"
npm run dev:server
```

視窗三，啟動正式資料流的前端：

```powershell
npm run dev
```

以一般視窗建立房間，再用無痕視窗輸入房號加入，即可得到兩個不同匿名 uid。Firebase Emulator UI 位於 http://localhost:4001 。若先前已開著 Next.js，修改 `.env.local` 後必須重新啟動它。

## 驗證

```powershell
npm run typecheck
npm run test
npm run test:web
npm run test:rules
npm run test:integration
npm run build
```

- `test`：純遊戲規則，涵蓋房主開始、秘密隔離、縮減卡組、蓋牌、猜測與逾時移交。
- `test` 另包含卡組快取、交易失敗／重試、實際讀寫路徑與同房間操作佇列測試。
- `test:web`：圖片網址快取、請求合併、失敗重試與過期畫面更新保護。
- `test:rules`：Firestore 全面拒絕 Web Client；Storage 只允許大廳房主上傳最大 `5 MB` 的 JPEG。
- `test:integration`：真實 Auth／Firestore／Storage Emulator 加上 Socket.IO，涵蓋兩人加入、第三人拒絕、權限、秘密資料、重連、Server 重啟、逾時判負、空房刪除、密碼與閒置清理。

第一次執行 Emulator 測試時，Firebase CLI 會下載官方 Firestore 與 Storage Emulator 元件。

## 操作延遲與快取

前端每次進入房間建立一份圖片網址快取。相同 Storage 路徑共用網址與進行中的請求，替換圖片的 UUID 路徑才觸發新請求；失敗可重試，離開頁面即清除。較早的圖片請求晚完成時，不會覆蓋較新的房間狀態。

Game Server 每次仍在 Firestore transaction 讀取房間、玩家與秘密目標，並等待成功提交後才廣播。卡組是可重建的記憶體快取，以房間文件的 `deckVersion` 驗證；修改卡組時連同版本一起提交。舊房間沒有版本欄位時視為 `0`，不用搬移資料。暖機後兩人遊戲的蓋牌讀取 5 份動態文件、通常只寫入房間和自己的玩家文件，不讀密碼、不重寫卡片，也不在廣播前重讀房間。

同房間的交易、連線名單更新與廣播依序處理，不同房間可並行。最後一條連線離開、刪除房間或伺服器關閉時清除卡組快取；重新加入與重啟都能從 Firestore 重建。此機制維持目前單一 Game Server instance 的部署前提，不支援直接在 Console 修改卡片而不更新 `deckVersion`。

設定 Game Server 的 `GAME_PERF_LOG=true` 可記錄 `game-perf` JSON 診斷；預設不輸出。記錄事件名稱、`queueMs`、`loadMs`、`ruleMs`、`transactionMs`、`attempts`／`retries`、`readDocuments`／`writeDocuments`、`cardReads`／`secretReads`、`cacheHit` 與 `ok`，不記錄房間內容、密碼、玩家目標或 token。讀寫計數累計交易嘗試，屬診斷操作數而非 Firebase 計費報表；`transactionMs` 包含讀取、規則及提交等待，不能將它與其他耗時相加。

整合測試明確使用 `--project demo-guesswho`，不受 Firebase CLI 當前選用的正式專案別名影響。測試包含暖機後各 10 次蓋牌／翻回的中位數與最大值；這是本機 Emulator 數據，不等同正式站延遲。部署後仍需用瀏覽器網路紀錄確認未更換圖片的操作新增網址請求為 0，再比較 Socket 回覆時間。

## 正式 Firebase 設定

1. 建立 Firebase 專案並啟用 Anonymous Authentication、Cloud Firestore 及 Storage。
2. 將前端 Firebase Web App 設定填入 `apps/web/.env.local` 或 Vercel 環境變數；公開 Firebase Web 設定不是伺服器密鑰。
3. 部署規則：

```powershell
firebase use --add
firebase deploy --only firestore:rules,storage
```

4. Game Server 的 Cloud Run Service Account 至少需要存取 Firestore 與 Storage 物件的權限。不要提交 Service Account JSON；Cloud Run 直接綁定 Service Account。

## Game Server 部署到 Cloud Run

先建立 Artifact Registry repository 與執行用 Service Account，再設定變數：

```powershell
$PROJECT_ID="你的專案 ID"
$REGION="asia-east1"
$IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/guesswho/game-server:latest"
gcloud builds submit --project $PROJECT_ID --config cloudbuild.yaml --substitutions "_IMAGE=$IMAGE" .
gcloud run deploy guesswho-game-server --project $PROJECT_ID --region $REGION --image $IMAGE --allow-unauthenticated --min 0 --max 1 --cpu 1 --memory 512Mi --timeout 3600 --service-account "你的執行用 Service Account" --set-env-vars "FIREBASE_PROJECT_ID=$PROJECT_ID,FIREBASE_STORAGE_BUCKET=你的 Storage bucket,WEB_ORIGIN=你的前端網址,CLEANUP_AUDIENCE=你的 Cloud Run 網址,CLEANUP_SCHEDULER_SERVICE_ACCOUNT=你的 Scheduler Service Account"
```

第一版固定 `maximum instances = 1`，因此不需要 Redis Adapter。Socket.IO 服務必須允許公開連線；`/internal/cleanup` 另外驗證 Cloud Scheduler 的 OIDC token 與指定 email。

每日清理排程範例：

```powershell
gcloud scheduler jobs create http guesswho-daily-cleanup --project $PROJECT_ID --location $REGION --schedule "0 4 * * *" --uri "你的 Cloud Run 網址/internal/cleanup" --http-method POST --oidc-service-account-email "你的 Scheduler Service Account" --oidc-token-audience "你的 Cloud Run 網址"
```

正式環境不要設定 `CLEANUP_SECRET`；它只供本機整合測試使用。

## Next.js 部署到 Vercel

repository 根目錄的 `vercel.json` 已指定 monorepo build。將下列環境變數放進 Vercel，並把 `NEXT_PUBLIC_GAME_SERVER_URL` 設為 Cloud Run HTTPS 網址：

```text
NEXT_PUBLIC_DEMO_MODE=false
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_APP_ID
NEXT_PUBLIC_FIREBASE_USE_EMULATORS=false
NEXT_PUBLIC_GAME_SERVER_URL
```

部署 Web 後，記得把實際 Vercel 網址更新到 Cloud Run 的 `WEB_ORIGIN`。所有 `NEXT_PUBLIC_` 值會在 `next build` 時寫入瀏覽器 bundle，修改後需重新部署 Web。

## 主要檔案

| 路徑 | 用途 |
|---|---|
| `apps/web/src/components/home.tsx` | 建立／加入正式房間及展示入口 |
| `apps/web/src/components/room.tsx` | 共用的 Retro 響應式房間 UI |
| `apps/web/src/lib/live.ts` | Socket 房間狀態、Storage 圖片與重連 |
| `apps/web/src/lib/firebase-client.ts` | 匿名登入及 Firebase Client 初始化 |
| `apps/web/src/lib/demo.ts` | 可獨立使用的單機展示資料 |
| `apps/game-server/src/game-rules.ts` | 純遊戲規則與安全狀態輸出 |
| `apps/game-server/src/firebase-admin.ts` | Firebase 初始化、完整狀態讀取與 Storage 清理 |
| `apps/game-server/src/room-store.ts` | 交易讀寫差異、卡組版本與可重建快取 |
| `apps/game-server/src/room-queue.ts` | 同房間操作順序與排隊診斷 |
| `apps/game-server/src/server.ts` | Token 驗證、Socket 事件、斷線與每日清理端點 |
| `firebase/firestore.rules` | 禁止 Web Client 直接存取遊戲狀態 |
| `firebase/storage.rules` | 房主、大廳、路徑、MIME 與大小限制 |
| `scripts/integration.mts` | 兩位真實匿名玩家的 Emulator 整合測試 |

完整遊戲與資料規則見 [`agent.md`](./agent.md)，前端與響應式設計規範見 [`ART_DIRECTION.md`](./ART_DIRECTION.md)。

## 已知依賴提示

`npm audit` 仍可能回報 Firebase 工具鏈或 `firebase-admin` 的間接相依提示。不要使用 `npm audit fix --force` 強制降級或覆寫；部署前重新檢查上游版本與實際 advisory 範圍。
