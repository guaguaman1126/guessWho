// rtdb.js — RTDB 兩人座位（RtdbSeats）模組版，給非 module 的 main.js 用動態 import()
// 用法（非 module main.js 裡）：
//   const mod = await import('./rtdb.js');
//   const { rtdbService, RtdbSeats } = mod;
//   const seats = rtdbService.createSeats({ roomId: '1126', uid: 'U1' });
//   await seats.setSeat('auto');

// === Firebase CDN（ESM） ===
import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getDatabase, ref, get, set, onDisconnect, runTransaction } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";

// 你專案的設定（含 RTDB databaseURL）
const firebaseConfig = {
    apiKey: "AIzaSyD0pR_cojwInvtrjJUs0DrRrYM1zwIHgYU",
    authDomain: "guesswho-9b36a.firebaseapp.com",
    databaseURL: "https://guesswho-9b36a-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "guesswho-9b36a",
    storageBucket: "guesswho-9b36a.appspot.com",
    messagingSenderId: "934150594298",
    appId: "1:934150594298:web:20ee190b8ab4c793b9f343",
    measurementId: "G-2ZXSVW7Y00"
};

// 初始化 App（避免重複 init）
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getDatabase(app);

/**
 * RtdbSeats
 * - 路徑：/rooms/{roomId}/playerA, /rooms/{roomId}/playerB
 * - API：setSeat('A'|'B'|'auto')、getSeat()、getPlayersCount()、setRoom()、leave()
 */
export class RtdbSeats {
    /**
     * @param {Object} options
     * @param {import('https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js').FirebaseApp} [options.app]
     * @param {string|number} options.roomId
     * @param {string} [options.uid]
     */
    constructor({ app: appArg, roomId } = {}) {
        // constructor({ app: appArg, roomId, uid } = {}) {
        // 保持「class 內容照舊」的精神：優先吃外部 app；沒給就用本模組初始化好的 app
        const theApp = appArg || app;
        if (!theApp) throw new Error('RtdbSeats: 必須提供 app（或讓模組先初始化成功）');
        this.db = getDatabase(theApp);

        if (roomId === undefined || roomId === null || String(roomId).trim() === '') {
            throw new Error('RtdbSeats: roomId 不可為空');
        }
        const rid = String(roomId).trim();
        this.basePath = `rooms/${rid.replace(/^\/*|\/*$/g, '')}`;
        this.roomId = rid;

        this.uid = (self.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)).slice(0, 8);
        this.mySeat = null; // 'A' | 'B' | null
    }

    _path(child) { return `${this.basePath}/${child}`; }
    _refA() { return ref(this.db, this._path('playerA')); }
    _refB() { return ref(this.db, this._path('playerB')); }

    async _releaseCurrentSeat() {
        if (!this.mySeat) return;
        const r = this.mySeat === 'A' ? this._refA() : this._refB();
        try { await set(r, ''); } catch { }
        try { await onDisconnect(r).cancel(); } catch { }
        this.mySeat = null;
    }

    async _tryClaim(seat) {
        const r = seat === 'A' ? this._refA() : this._refB();
        const res = await runTransaction(r, cur => (cur === null || cur === '') ? this.uid : cur);
        if (res.committed && res.snapshot.val() === this.uid) {
            onDisconnect(r).set(''); // 斷線自動釋位
            this.mySeat = seat;
            return seat;
        }
        return null;
    }

    /** setSeat('A'|'B'|'auto') → Promise<'A'|'B'|null> */
    async setSeat(seat) {
        if (!['A', 'B', 'auto'].includes(seat)) throw new Error('setSeat: seat 必須是 A/B/auto');
        if (this.mySeat && seat !== 'auto' && seat !== this.mySeat) await this._releaseCurrentSeat();
        if (seat === 'A' || seat === 'B') return this._tryClaim(seat);
        const got = (await this._tryClaim('A')) || (await this._tryClaim('B'));
        if (!got) {
            console.warn(`[RtdbSeats] 房間已滿人：${this.basePath}（A、B 皆被佔用）`);
            // alert("房間已滿");
            // window.location.href = `home.html`;
        }

        return got;
    }

    /** getSeat() → Promise<'A'|'B'|null> */
    async getSeat() {
        const [aSnap, bSnap] = await Promise.all([get(this._refA()), get(this._refB())]);
        const aVal = aSnap.val();
        const bVal = bSnap.val();
        if (aVal === this.uid) { this.mySeat = 'A'; return 'A'; }
        if (bVal === this.uid) { this.mySeat = 'B'; return 'B'; }
        this.mySeat = null; return null;
    }

    /** getPlayersCount() → Promise<number>（0~2） */
    async getPlayersCount() {
        const [aSnap, bSnap] = await Promise.all([get(this._refA()), get(this._refB())]);
        let n = 0; if (aSnap.exists() && aSnap.val() !== '') n++; if (bSnap.exists() && bSnap.val() !== '') n++;
        return n;
    }

    /** setRoom(roomId) → Promise<void> */
    async setRoom(roomId) {
        await this._releaseCurrentSeat();
        const rid = String(roomId).trim();
        this.basePath = `rooms/${rid.replace(/^\/*|\/*$/g, '')}`;
        this.roomId = rid;
        console.info(`[RtdbSeats] 已切換到新房間：${this.basePath}`);
    }

    /** leave() → Promise<void> */
    async leave() { await this._releaseCurrentSeat(); }


    async show() {
        console.log('auto 搶位 =', await this.getSeat());
        console.log('我的座位 =', await this.getSeat());
        console.log('人數 =', await this.getPlayersCount());
    }
}

// 服務物件：比照你的 Firestore 模組，先在模組層完成初始化，這裡提供工廠方法
class RtdbService {
    constructor(app, db) { this.app = app; this.db = db; }
    /** 建立一個房間的座位管理器 */
    createSeats({ roomId }) { return new RtdbSeats({ app: this.app, roomId }); }
    // createSeats({ roomId, uid }) { return new RtdbSeats({ app: this.app, roomId, uid }); }
}

const rtdbService = new RtdbService(app, db);

// 匯出 class 與 service（比照：export { Database, dbService } 的寫法）
export { rtdbService, app, db };
