    // --- ESM 版 Firebase SDK ---
    import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
    import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-analytics.js";
    import { getStorage, ref, uploadBytes, getDownloadURL, listAll, deleteObject } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

    // --- 你的專案設定（若 bucket 報錯，將 storageBucket 改成 guesswho-9b36a.appspot.com）---
    const firebaseConfig = {
      apiKey: "AIzaSyD0pR_cojwInvtrjJUs0DrRrYM1zwIHgYU",
      authDomain: "guesswho-9b36a.firebaseapp.com",
      databaseURL: "https://guesswho-9b36a-default-rtdb.asia-southeast1.firebasedatabase.app",
      projectId: "guesswho-9b36a",
      storageBucket: "guesswho-9b36a.firebasestorage.app",
      messagingSenderId: "934150594298",
      appId: "1:934150594298:web:20ee190b8ab4c793b9f343",
      measurementId: "G-2ZXSVW7Y00"
    };

    // --- 初始化（若已存在就重用）---
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    try { getAnalytics(app); } catch (_) { /* analytics 可選 */ }

    // --- 模組版 StorageService（使用 v9 modular API；constructor(roomID)）---
    class StorageService {
      constructor(roomID) {
        this.storage = getStorage(app);
        this.roomID = String(roomID ?? '').trim() || 'default';
        this.baseDir = 'rooms';
        this.tryExts = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
      }
      _buildPath(index, fileNameOrExt) {
        const safeIndex = String(index ?? '').trim() || '0';
        let ext = 'jpg';
        if (fileNameOrExt) {
          const s = String(fileNameOrExt);
          const dot = s.lastIndexOf('.');
          ext = (dot >= 0 ? s.slice(dot + 1) : s).toLowerCase();
        }
        return `${this.baseDir}/${this.roomID}/${safeIndex}.${ext}`;
      }
      async uploadImage(index, file) {
        if (!file) throw new Error('uploadImage: file 不可為空');
        const path = this._buildPath(index, file.name || 'img.jpg');
        const fileRef = ref(this.storage, path);
        await uploadBytes(fileRef, file, { contentType: file.type || 'application/octet-stream' });
        const url = await getDownloadURL(fileRef);
        return { path, url };
      }
      async fetchImage(index) {
        const idx = String(index ?? '').trim() || '0';
        for (const ext of this.tryExts) {
          const path = `${this.baseDir}/${this.roomID}/${idx}.${ext}`;
          try {
            const url = await getDownloadURL(ref(this.storage, path));
            return url;
          } catch (err) {
            if (err?.code !== 'storage/object-not-found') throw err;
            return null;
          }
        }
        throw new Error('fetchImage: 找不到圖片');
      }
      async cleanRoom() {
        const folderRef = ref(this.storage, `${this.baseDir}/${this.roomID}`);
        await this._deleteFolder(folderRef);
      }
      async _deleteFolder(folderRef) {
        const res = await listAll(folderRef);
        await Promise.all(res.items.map(itemRef => deleteObject(itemRef).catch(e => {
          if (e?.code !== 'storage/object-not-found') throw e;
        })));
        for (const sub of res.prefixes) {
          await this._deleteFolder(sub);
        }
      }

    
    
    
    }

    // 讓非模組腳本也能直接 new；並提供「ready Promise」避免競速問題
    window.StorageService = StorageService;
    window.__storageServiceReady = Promise.resolve(StorageService);
    // （可選）也可以發事件供 listen：
    window.dispatchEvent(new Event('storage-service-ready'));
