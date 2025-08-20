import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const firebaseConfig = {
    databaseURL: "https://guesswho-9b36a-default-rtdb.asia-southeast1.firebasedatabase.app",
    apiKey: "AIzaSyD0pR_cojwInvtrjJUs0DrRrYM1zwIHgYU",
    authDomain: "guesswho-9b36a.firebaseapp.com",
    projectId: "guesswho-9b36a",
    storageBucket: "guesswho-9b36a.appspot.com",
    messagingSenderId: "934150594298",
    appId: "1:934150594298:web:20ee190b8ab4c793b9f343",
    measurementId: "G-2ZXSVW7Y00"


};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const isGridField = (f) => f === 'imageNames' || f === 'imageUrls';
const clamp24 = (n) => Math.min(24, Math.max(1, n | 0));

class Database {
    constructor(db) { this.db = db; }

    async getField(path, id, field, index) {
        if (isGridField(field)) {
            if (typeof index === 'number') {
                const ref = doc(this.db, path, id, field, String(clamp24(index)));
                const snap = await getDoc(ref);
                return snap.exists() ? snap.data()?.value ?? '' : '';
            }
            const tasks = Array.from({ length: 24 }, (_, i) => getDoc(doc(this.db, path, id, field, String(i + 1))));
            const snaps = await Promise.all(tasks);
            return snaps.map(s => (s.exists() ? s.data()?.value ?? '' : ''));
        }
        const ref = doc(this.db, path, id);
        const snap = await getDoc(ref);
        return snap.exists() ? snap.data()?.[field] ?? null : null;
    }

    async setField(path, id, field, value, index) {
        if (isGridField(field)) {
            if (typeof index === 'number') {
                await setDoc(doc(this.db, path, id, field, String(clamp24(index))), { value: String(value ?? '') }, { merge: true });
                return;
            }
            if (Array.isArray(value)) {
                const tasks = value.slice(0, 24).map((v, i) => setDoc(doc(this.db, path, id, field, String(i + 1)), { value: String(v ?? '') }, { merge: true }));
                await Promise.all(tasks);
                return;
            }
            throw new Error('grid 寫入請提供 index 或 24 長度陣列');
        }
        await setDoc(doc(this.db, path, id), { [field]: value }, { merge: true });
    }

    async show(path, id) {
        console.group('Subcollections: imageNames & imageUrls');
        const [names, urls] = await Promise.all([
            this.getField(path, id, 'imageNames'),
            this.getField(path, id, 'imageUrls')
        ]);
        console.group('— imageNames (1~24) —');
        names.forEach((v, i) => console.log(`imageNames[${i + 1}]: ${v}`));
        console.groupEnd();
        console.group('— imageUrls (1~24) —');
        urls.forEach((v, i) => console.log(`imageUrls[${i + 1}]: ${v}`));
        console.groupEnd();
        console.groupEnd();

        console.group('Document fields');
        const fields = await Promise.all([
            this.getField(path, id, 'isOpened'),
            this.getField(path, id, 'targetA'),
            this.getField(path, id, 'targetB'),
            this.getField(path, id, 'isReadyA'),
            this.getField(path, id, 'isReadyB'),
            this.getField(path, id, 'guessedA'),
            this.getField(path, id, 'guessedB'),
            this.getField(path, id, 'currentTurn'),
            this.getField(path, id, 'winner'),
            this.getField(path, id, 'isPlaying')
        ]);
        ['isOpened', 'targetA', 'targetB', 'isReadyA', 'isReadyB', 'guessedA', 'guessedB', 'currentTurn', 'winner', 'isPlaying'].forEach((key, i) => console.log(`${key}:`, fields[i]));
        console.groupEnd();
    }

    async setRoom(id) {
        const path = 'rooms';
        await Promise.all([
            this.setField(path, id, 'isOpened', true),
            this.setField(path, id, 'currentTurn', null),
            this.setField(path, id, 'targetA', 0),
            this.setField(path, id, 'targetB', 0),
            this.setField(path, id, 'isReadyA', false),
            this.setField(path, id, 'isReadyB', false),
            this.setField(path, id, 'guessedA', false),
            this.setField(path, id, 'guessedB', false),
            this.setField(path, id, 'winner', null),
            this.setField(path, id, 'isPlaying', false),
            // 這兩行會各自建立 24 個空字串
            this.setField(path, id, 'imageNames', Array(24).fill('王大明')),
            this.setField(path, id, 'imageUrls', Array(24).fill('')),
        ]);
    }


}

// 這裡要先 new 出來
const dbService = new Database(db);

// 匯出 class 跟物件都可以
export { Database, dbService };





