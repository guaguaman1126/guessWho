# GuessWho 重製專案指引

## 目標

將舊版原生 HTML、CSS、JavaScript 遊戲重製為三層架構：

- Next.js、React、TypeScript、Tailwind CSS：網站 UI 與一般 HTTP 頁面。
- Node.js、TypeScript、Express、Socket.IO：獨立的即時遊戲 Server。
- Firebase：Authentication、Cloud Firestore 與 Storage。

舊版專案只作為需求與素材參考。新程式全部放在本資料夾，不直接修改上層舊版檔案。

## 固定架構

```text
Browser
├─ HTTPS → Next.js Web
├─ Socket.IO → Game Server
└─ Firebase Authentication／Storage

Game Server
└─ Firebase Admin SDK → Cloud Firestore
```

部署目標：

- Next.js：Vercel 或 Firebase App Hosting。
- Game Server：Google Cloud Run。
- 資料與圖片：Firebase。

Next.js 與 Game Server 必須分開。不要建立 Next.js Custom Server，也不要把 Socket.IO 放進 Next.js Route Handler。

## 技術選擇

- 使用 npm workspaces 管理同一個 repository。
- Game Server 與 shared package 也使用 TypeScript，前後端共用 Socket payload 型別。
- Game Server 使用 Node.js、Express、Socket.IO、Firebase Admin SDK。
- 前端技術、目錄、狀態管理、圖片互動、環境變數、響應式設計與無障礙規範全部集中在 [`ART_DIRECTION.md`](./ART_DIRECTION.md)。
- 優先使用平台原生能力與現有套件，不建立推測未來才需要的抽象層。

## 目錄規劃

```text
更新版guessWho/
├─ apps/
│  ├─ web/                     # 詳見 ART_DIRECTION.md
│  └─ game-server/
│     └─ src/
│        ├─ game-rules.ts
│        ├─ firebase-admin.ts
│        ├─ socket-handlers.ts
│        └─ server.ts
├─ packages/
│  └─ shared/
│     ├─ game-types.ts
│     └─ socket-events.ts
├─ firebase/
│  ├─ firestore.rules
│  └─ storage.rules
├─ ART_DIRECTION.md
├─ .env.example
├─ package.json
├─ tsconfig.base.json
└─ README.md
```

只有檔案真的變大或出現第二個使用者時才繼續拆分。不要預先建立 controller、repository、factory、interface 等空架構。

## 各層責任

### Next.js Web

Next.js Web 的技術選擇、責任邊界、目錄、狀態管理、畫面、圖片處理、Tailwind、RWD、觸控與無障礙規範全部集中在 [`ART_DIRECTION.md`](./ART_DIRECTION.md)。所有前端工作開始前必須先閱讀該文件，本文件不維護第二份前端規格。

### Game Server

Game Server 是唯一裁判，負責：

- 驗證 Socket handshake 中的 Firebase ID Token。
- 建立、加入、離開、恢復及清理房間。
- 維護房主權限、房間密碼與保存方式。
- 限制每個房間最多兩位玩家。
- 分配 A、B 座位。
- 驗證準備、選擇目標、猜測與結束回合。
- 只在 Server 產生隨機先手。
- 使用 Firestore transaction 更新重要狀態。
- 對每位玩家產生不同的安全狀態，不能洩漏對手目標。
- 更新 Firestore 後才透過 Socket.IO 廣播。
- 每日刪除超過 `30` 天無人成功進入的保留房間及圖片。

收到前端資料時，一律先驗證型別、房號、玩家身分、遊戲狀態與回合權限。

### Firebase

- Authentication：第一版使用匿名登入，`uid` 是玩家身分。
- Firestore：永久保存房間與遊戲狀態，是唯一資料來源。
- Storage：保存角色圖片，不把 base64 圖片寫進 Firestore。
- Firestore Rules：拒絕 Web Client 直接寫入遊戲資料。
- Storage Rules：必須驗證登入、路徑、圖片 MIME type 與大小。

Game Server 重啟或 Socket.IO 重新連線時，必須從 Firestore 恢復狀態，不能依賴記憶體中的房間資料。

## 最小 Firestore 結構

```text
rooms/{roomId}
  status: lobby | playing | paused
  hostUid: uid | null
  playerUids: [uid]
  cardCount: 9 | 16 | 25
  retentionPolicy: delete_when_empty | retain
  currentTurnUid: uid | null
  turnAction: null | question | guess
  lastResult: { winnerUid, reason, endedAt } | null
  lastEnteredAt
  emptySince
  createdAt
  updatedAt

rooms/{roomId}/players/{uid}
  seat: A | B
  ready: boolean  # 僅非房主使用；房主固定為 false，開始條件不檢查房主 ready
  connected: boolean
  disconnectDeadline
  foldedCardIds: [number]

rooms/{roomId}/targets/{uid}
  targetCardId: number

rooms/{roomId}/cards/{cardId}
  name: string
  imagePath: string

rooms/{roomId}/secrets/access
  password: string
```

`targets` 與 `secrets` 只能由 Game Server 的 Firebase Admin SDK 存取。傳給玩家的狀態只能包含自己的 `targetCardId`，不得包含對手目標或房間密碼。

## 最小 Socket.IO 協定

前端送出：

```text
room:create
room:join
room:leave
room:update-settings
card:update
target:select
player:ready
game:start
turn:question-complete
game:guess
card:fold-toggle
turn:end
```

Server 回傳：

```text
room:state
room:error
```

所有前端事件都使用 acknowledgment 回傳成功或錯誤。第一版只用一個 `room:state` 傳完整安全狀態，不先建立大量細碎事件。

## 完整遊戲規則

### 創建與加入房間

- 首頁分開提供「創建房間」與「加入房間」。
- Game Server 產生不可預測且需檢查碰撞的房號，不由前端指定現有房號。
- 房主創建時必須選擇 `9`、`16`、`25` 張卡片之一。
- 每個房間最多兩位玩家；第三位玩家一律拒絕，觀戰不在第一版範圍。
- 創建者是房主。房主逾時離線時，權限移交給仍在線的另一位玩家。
- 玩家使用 Firebase 匿名登入的 `uid` 識別；同一 `uid` 的多個分頁視為同一玩家，而不是占用兩個座位。

房主建立房間時選擇保存方式：

- `delete_when_empty`：預設值。所有玩家的 `60` 秒重連期限都結束且房內無人時，刪除 Firestore 房間、子集合與 Storage 圖片。
- `retain`：房主必須設定密碼。加入或重新開啟房間都需要房號與密碼；房內無人時保留資料。

保留房間的密碼規則：

- 密碼直接以明碼保存在 `rooms/{roomId}/secrets/access`，Server 直接比對字串。
- `secrets/access` 不允許 Web Client 直接讀取；密碼不得出現在 log、acknowledgment、`room:state` 或錯誤訊息。
- 保留房間沒有人在線時，第一位通過密碼驗證的加入者取得房主權限。
- 成功加入時才更新 `lastEnteredAt`；錯誤密碼與單純查詢不得延長保存期限。

### 大廳與卡組設定

- `lobby` 是初次進房及每局結束後的共同狀態。
- 只有房主且房間為 `lobby` 時，可以選擇卡片數量、上傳或替換圖片、修改名稱；`playing` 與 `paused` 都不允許變更。
- 卡片編號必須是 `1` 到 `cardCount`，不能有缺號或重複。
- Server 與雙方前端一律依數字 `cardId` 升冪排列卡片，不依賴 Firestore 回傳順序，因此雙方看到的位置一致。
- 卡片數量從 `25` 改為 `9` 時，只保留 `cardId` 為 `1～9` 的卡片；刪除 `10～25` 的 Firestore 卡片文件及 Storage 圖片。
- 卡片數量增加時保留既有編號內容，新增的編號先建立為未完成空位，補齊名稱與圖片前不能開始。
- 每張卡片都必須有非空白名稱與有效圖片，卡組才算完成。
- 房主可在 `lobby` 隨時修改卡片數量或內容，包括玩家已按準備之後。
- 卡片數量、名稱或圖片變更不會改變非房主玩家的 ready，也不會清除雙方仍指向有效 `cardId` 的 target。
- 縮減卡片數量時，Server 只清除超出新範圍的 target；仍在範圍內的 target 保持不變。target 被清除的玩家必須重新選擇，否則房主不能開始。
- 修改某個有效 `cardId` 的名稱或圖片時，選擇該編號的 target 保持不變，並以修改後的卡片內容為準。
- `lobby` 不開放蓋牌，也不建立或修改 `foldedCardIds`。
- 兩位玩家各自秘密選擇一張目前卡組中的卡片作為目標。房主不需要準備，按下「開始遊戲」即代表房主確認開始。
- 只有非房主玩家可以送出 `player:ready` 以準備／取消準備；準備時必須有有效 target，房主送出此事件一律拒絕。
- 房主可在 `lobby` 重新選擇目標；非房主玩家已準備且 target 仍有效時，須先取消準備才能換目標，再重新準備。
- 若非房主玩家的 target 因縮減卡組而失效，保留其 ready，允許直接補選有效目標；補選後不必重按準備。
- 只有房主看得到「開始遊戲」操作；Server 必須在同一個 transaction 確認房間為 `lobby`、發起者為目前房主、恰有兩位在線玩家、卡組完整、雙方 target 有效且非房主玩家 ready 為 true，才能開始。不檢查房主 ready。
- 非房主玩家按下準備不會自動開始遊戲，必須由房主明確開始。

### 開始與回合

- Game Server 使用安全的 Server 端隨機方式決定先手，前端不得產生或覆寫先手。
- 遊戲開始後鎖定 `cardCount`、卡片名稱與圖片，直到該局結束回到 `lobby`。
- 每回合只能選擇「口頭提問」或「猜測」其中一種行動。
- 口頭提問及回答發生在系統外；對手可以回答「是」、「不是」或依情況提供提示。
- 完成口頭問答後，當前玩家按下「已完成提問」，Server 將 `turnAction` 設為 `question`。
- `turnAction` 已有值後不得在同一回合再次提問或猜測。
- 只有目前回合玩家在完成提問後可以按下「結束回合」。Server 切換玩家並把 `turnAction` 重設為 `null`。
- 尚未完成提問或猜測前，不允許直接結束回合。

### 猜測與蓋牌

- 只有目前回合玩家且 `turnAction` 為 `null` 時可以猜測一次。
- 猜中對手秘密目標時，猜測者獲勝，該局立即結束。
- 猜錯時，Server 記錄 `guess` 行動並自動切換回合，不需要再按結束回合。
- 蓋牌是每位玩家自己的排除筆記，不會刪除角色，也不會改變秘密目標。
- 玩家只能在 `playing` 狀態蓋上或翻回自己的卡片；`lobby` 與 `paused` 不開放蓋牌。
- 蓋住的卡片編號記錄在該玩家的 `foldedCardIds`，對手不能看見或修改。
- 每次蓋上或翻回都由 Game Server 驗證並立即寫入 Firestore，不能只保存在 React state。
- 重新整理、短暫斷線、重新連線或 Game Server 重啟後，都必須從 Firestore 恢復完全相同的蓋牌狀態。

### 每局結束與下一局

- 猜中或斷線逾時判負後，Server 原子化寫入 `lastResult`，再把房間送回 `lobby`。
- 回到 `lobby` 時沿用上一局的 `cardCount`、卡片名稱與圖片，並解除卡組鎖定。
- 同時清除 `currentTurnUid`、`turnAction`、雙方 ready、雙方 target 與 `foldedCardIds`。
- 房主可以在下一局開始前調整卡片數量或內容。
- 兩位玩家必須重新選擇秘密目標，非房主玩家重新準備，再由房主按下開始；房主不需要準備。
- 不需要另外的 `game:restart` 投票或事件；每局結束自動回到大廳。

## 每個狀態允許的操作

| 狀態 | 允許操作 | 禁止操作 |
|---|---|---|
| `lobby` | 加入／離開、房主改卡片數量與內容、依準備規則選目標、非房主準備／取消準備、房主開始 | 房主準備、蓋牌、提問、猜測、結束回合 |
| `playing` | 當前玩家完成提問、猜測、結束合法回合；每位玩家調整自己的蓋牌 | 修改卡組、改目標、改準備、非當前玩家操作回合 |
| `paused` | 原玩家重新連線、查看斷線倒數 | 所有遊戲操作、修改卡組、開始下一局 |

所有操作都由 Game Server 依 Firestore 當前狀態再次驗證。前端隱藏或停用按鈕只改善體驗，不能代替 Server 權限檢查。

## 邊界與斷線處理

- Socket 暫時中斷、重新整理或網路切換時，為該玩家保留座位 `60` 秒。
- 同一玩家若仍有其他分頁 Socket 在線，不視為斷線。
- `playing` 中任一玩家全部 Socket 中斷後，房間改為 `paused`，暫停所有遊戲操作；`60` 秒斷線寬限倒數持續進行，不能暫停。目前沒有另外的回合時間限制。
- 玩家在自己的 `60` 秒期限內以相同 `uid` 重連，恢復原座位、目前回合、回合行動、目標及 `foldedCardIds`；只有雙方都在線且該局尚未結束時，房間才能回到 `playing`，否則仍為 `paused`。大廳斷線重連則維持 `lobby`。
- 玩家逾時未回來時，仍在線的對手以 `disconnect_forfeit` 獲勝，然後房間回到 `lobby`。
- 房主逾時離線且另一位玩家仍在線時，將 hostUid 移交給仍在線玩家；若正在遊戲，該玩家同時因對手逾時獲勝。
- 房主移交時，將新房主的 ready 重設為 false，開始條件改為檢查新加入的非房主玩家；新加入者 ready 預設為 false。舊房主座位釋放後再次加入時，依目前 hostUid 判斷身分，不自動取回房主權限。
- 玩家主動按下離開視為放棄 `60` 秒寬限；遊戲中立即判負，大廳中立即釋放座位。
- 兩位玩家都離線時，分別保留到各自的 `disconnectDeadline`；期限全部結束後才判定房內無人。
- `delete_when_empty` 房間在確認無人後，刪除房間文件、所有子集合及 `rooms/{roomId}/` 下的全部圖片。
- `retain` 房間在確認無人後保留卡組與設定，但清空玩家、目標、準備、蓋牌與進行中回合；下次用房號與密碼重新進入。
- 所有保留房間只要 `lastEnteredAt` 已滿 `30` 天沒有成功加入，就刪除房間、子集合及全部圖片。
- 使用每日一次的受驗證 Cloud Scheduler 工作呼叫 Game Server 清理端點；清理必須可重複執行，部分檔案已不存在時也不能整批失敗。
- 建立、加入、開始、回合切換、猜測、房主移交與結束遊戲必須使用 Firestore transaction 或等效原子操作，避免雙方同時操作產生兩個結果。

第一版不建立文字聊天、配對系統、觀戰、排行榜、好友、通知或 AI。玩家提問維持口頭進行；有明確需求時再增加聊天功能。

## 圖片規則

- Storage 物件放在 `rooms/{roomId}/cards/`，每次替換使用新物件路徑，避免舊圖片快取。
- 只有房主且房間處於 `lobby` 時可以上傳、替換或刪除圖片。
- Storage Rules 必須限制登入身分、房主、房間狀態、路徑、檔案大小與圖片 MIME type。
- Firestore 只保存 `imagePath`，不要保存永久下載網址。
- 替換圖片後由 Server 清除舊物件；刪除房間時清除整個房間 prefix。
- 瀏覽器端選檔、裁切、壓縮、預覽、載入與錯誤顯示規範見 [`ART_DIRECTION.md`](./ART_DIRECTION.md)。

## 環境變數與秘密

只能放在 Game Server 的設定：

```text
FIREBASE_PROJECT_ID
GOOGLE_APPLICATION_CREDENTIALS 或 Cloud Run Service Account
WEB_ORIGIN
PORT
```

不得提交 Service Account JSON、私鑰或實際 `.env`。前端公開環境變數及其限制見 [`ART_DIRECTION.md`](./ART_DIRECTION.md)；真正的權限必須由 Authentication、Rules 與 Server 驗證控制。

## Cloud Run 第一版設定

- Request-based billing。
- Minimum instances：0。
- Maximum instances：1。
- CPU：1 vCPU。
- Memory：512 MiB。
- Timeout：3600 秒。
- Server 必須處理重新連線並重新讀取 Firestore。
- Cloud Scheduler 每日以專用 Service Account 呼叫一次受 IAM 保護的清理端點。

第一版不加入 Redis。只有確定需要多個 Game Server instance 時才加入 Socket.IO Adapter。

## 開發順序

採用「建立架構與安裝依賴 → 完成前端展示 → 人工驗收 → 後端與資料庫實作 → 整合驗證」的順序。前端驗收是必要的人工檢查點，AI 不得自動越過。

### 第一階段：架構與依賴一次準備

1. 建立 npm workspaces、`apps/web`、`apps/game-server` 與 `packages/shared`，設定 TypeScript、開發指令、build 指令與 `.env.example`。
2. 安裝目前規格已確定需要的前後端依賴，並保存根目錄 `package-lock.json`：前端使用 Next.js、React、React DOM、Tailwind CSS、Firebase Web SDK、socket.io-client；後端使用 Express、Socket.IO、Firebase Admin SDK；開發依賴包含 TypeScript、必要的型別套件、Tailwind 建置整合與 Server 的 TypeScript 開發執行工具。具體相容版本於建置時確認，不預裝未使用的套件。
3. 完成可啟動的 Next.js 頁面及最小 Game Server 入口／健康檢查。此階段 Server 只驗證骨架能執行，尚不實作遊戲裁判、Firestore 寫入或雲端部署。
4. 在 shared 定義房間狀態、卡片、玩家安全資料與 Socket 事件的 TypeScript 型別，讓前端展示與日後真實連線使用相同資料格式。
5. 確認安裝成功、前端與 Server 可分別啟動，並提供 README 啟動方式。前端展示必須可在未設定 Firebase 憑證、未啟動 Server 的情況下使用。

### 第二階段：依 ART_DIRECTION.md 完成前端

1. 先閱讀並遵守 [`ART_DIRECTION.md`](./ART_DIRECTION.md)，完成首頁、創建／加入房間、大廳、遊戲畫面、卡片放大、圖片裁切預覽與賽後結果提示。
2. 使用本地示範圖片與符合 shared 型別的 mock 資料完成互動展示；建立簡單的展示資料入口，供日後替換為 Socket.IO，不另外建立一套正式遊戲引擎。
3. 完成房主／來賓、`9／16／25` 張卡片、ready／target、`lobby／playing／paused`、不同回合權限、蓋牌／翻回／指認確認、載入／錯誤／重連提示等展示情境。圖片上傳先展示本地選檔、裁切與預覽。
4. 完成手機、平板、桌機的正方形卡片區、固定排序、置中放大視窗、觸控限制、Retro Design 與無障礙，依 `ART_DIRECTION.md` 的前端驗收標準逐項檢查。
5. 執行前端型別與 build 檢查，實際操作主要頁面與展示情境；清楚標示尚未接線的登入、多人同步、資料保存與上傳功能。

### 必須暫停：使用者人工驗收前端

- 第二階段完成後，AI 必須停止進入第三階段，提供啟動指令、可開啟的展示入口、已完成項目、未接線項目與已知問題，讓使用者實際確認。
- 使用者主要驗收手機／平板版面、卡片大小、圖片放大與底部操作、首頁與房間流程，以及整體美術風格。
- 只有使用者明確表示「前端確認，可以開始後端」或同等意思後，才能開始第三階段。沒有回覆不代表通過；要求修改畫面也不代表已通過。
- 使用者要求調整時，完成前端修正與相關檢查後再次交付人工驗收；不得趁此進行後端遊戲邏輯、Firebase 資料寫入、清理排程或部署。
- 這個檢查點確認的是前端展示；mock 能操作不代表多人連線、斷線恢復或資料庫功能已完成。

### 第三階段：完善後端與資料庫

1. 完成 Firebase 匿名登入、Socket Token 驗證、Firestore 資料結構及 Firestore／Storage Rules；權限規則與資料功能同步建立。
2. 完成創建／加入房間、保存選項、密碼驗證、兩人限制與房主權限。
3. 完成 `9／16／25` 張卡片設定、圖片上傳與替換清理、縮減卡組及失效 target 處理。
4. 完成選目標、ready、房主開始、隨機先手、口頭提問記錄、猜測、蓋牌保存、勝負與賽後回大廳。
5. 完成 `60` 秒斷線恢復、房主移交、空房刪除與 `30` 天清理工作。
6. 逐項把前端展示資料替換成真實 Firebase／Socket.IO 資料，保留已驗收的介面；正式模式不得使用 mock 判定結果或保存遊戲狀態。

### 第四階段：整合驗證與部署準備

1. 執行下方「最小驗證標準」，以兩個獨立玩家身分測試真實多人流程、權限、資料保存與斷線恢復。
2. 重新檢查手機、平板與桌機實際連線後的操作及錯誤提示，執行型別、build 與必要的遊戲規則測試。
3. 完成 Web、Game Server 與每日清理工作的部署設定及說明，確認環境設定後再依使用者授權部署。

每個階段都交付可執行、可驗證的結果；第一階段只建立必要骨架，不提前填入後續階段的業務實作。

## 最小驗證標準

- 使用兩個無痕視窗加入同一房間，第三位玩家必須被拒絕。
- 建立房間只能選 `9`、`16` 或 `25` 張，房主以外的玩家不能修改卡組。
- `lobby` 卡組變更不改變 ready，並保留仍有效的 target；縮減數量只清除超出新範圍的 target。
- `25 → 9` 會刪除 `10～25` 的卡片文件與圖片，雙方畫面都只按順序顯示 `1～9`；遊戲開始後任何人都不能改卡組。
- 房主沒有準備步驟，Server 拒絕房主的 `player:ready`；非房主準備後仍不會自動開始，只有房主能開始。
- 開始時必須有兩位在線玩家、完整卡組、雙方有效 target 與非房主 ready；房主 ready 為 false 不能阻擋開始。
- 非房主準備後不能直接換有效 target；縮減卡組清除其 target 時保留 ready，允許直接補選，補選前不能開始。
- 對手看不到秘密角色，即使檢查 Network 與 Socket payload。
- 同一回合完成提問後不能猜測；猜錯會自動換回合，猜中會結束該局。
- `lobby` 與 `paused` 不能蓋牌；`playing` 的蓋牌資料必須寫入本人的 `foldedCardIds`，並可在斷線重連後完整恢復。
- 非當前玩家不能猜測或結束回合，蓋牌資料只能由本人讀寫。
- 每局結束會保留卡組、清除目標與準備，回到大廳等待房主再次開始。
- 兩端同時操作時，Firestore 仍只有一個合法結果。
- 重新整理、`60` 秒內短暫斷線與 Server 重啟後可以恢復遊戲。
- 斷線超過 `60` 秒會正確判負或移交房主，不會留下被占用的座位。
- 預設空房會刪除 Firestore 與圖片；保留房間必須驗證密碼，閒置滿 `30` 天仍會完整刪除。
- 密碼明碼只能存在 `secrets/access`，不能出現在其他 Firestore 文件、log、acknowledgment 或 `room:state`。
- 非圖片、過大圖片與未登入上傳會被拒絕。
- `game-rules.ts` 使用 Node 內建 `node:test` 保留一個最小測試檔，不先導入大型測試框架。

## 實作原則

- 先讀舊版實際流程，再移植功能；不要逐行翻譯 `room.js`。
- 前端送出意圖，Server 驗證並決定結果。
- Firestore 是唯一永久狀態來源，Socket.IO 只負責傳輸。
- 優先修正根因，不在多個呼叫端重複補判斷。
- 不為未提出的需求增加套件、服務、抽象或設定。
- 保留必要的安全驗證與錯誤處理；前端操作品質規範見 `ART_DIRECTION.md`。
