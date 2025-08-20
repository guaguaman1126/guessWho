// 初始化創建資料庫跟相關function
let dbService;
let seatsDb;
let storageService;
let myseat;
let roomID;
let myTarget;
let enemyTarget;
let isReady;
let enemyIsReady;
let myTurn;
let enemyTurn;
let myGuessed;
let enemyGuessed;

document.addEventListener('DOMContentLoaded', () => {
    setRoomIdFromURL();
});


// realtime database

async function initializing() {
    try {
        const moduleObj = await import('./data.js');
        dbService = moduleObj.dbService; // fsdb

        const mod = await import('./rtdb.js');
        const { rtdbService /*, RtdbSeats*/ } = mod;
        seatsDb = rtdbService.createSeats({ roomId: roomID });

        storageService = new StorageService(roomID);//storage

        if (await seatsDb.getPlayersCount() == 2) {
            alert("該房間已滿");
            window.location.href = `home.html`;
        }
        await seatsDb.setSeat('auto');

        let isOpened = await dbService.getField('rooms', roomID, 'isOpened');

        const seat = await seatsDb.getSeat();
        if (seat === 'A') {
            myseat = 'A';
            myTarget = 'targetA';
            enemyTarget = 'targetB';
            isReady = "isReadyA";
            enemyIsReady = "isReadyB";
            myTurn = "A";
            enemyTurn = "B";
            myGuessed = "guessedA";
            enemyGuessed = "guessedB";

        } else if (seat === 'B') {
            myseat = 'B';
            myTarget = 'targetB';
            enemyTarget = 'targetA';
            isReady = "isReadyB";
            enemyIsReady = "isReadyA";
            myTurn = "B";
            enemyTurn = "A";
            myGuessed = "guessedB";
            enemyGuessed = "guessedA";
        }

        if (!isOpened) {
            await dbService.setRoom(roomID);//缺邏輯把isOpened關掉
        }

        await seatsDb.show();
        await dbService.show('rooms', roomID);

        const stopIsPlaying = watchIsPlaying(roomID, { interval: 1000, immediate: false });
        const stopWatchTurn = watchCurrentTurn(roomID, { immediate: true });
        // updateAll();
        handleUpdateAll();
    } catch (e) {
        console.error('載入 db 模組失敗：', e);
    }
}

//更新名子(上傳) 
async function updateName(dataIndex, name, nameContainer) {

    if (!dbService) throw new Error('dbService 尚未初始化');

    const idx = Number(dataIndex);
    if (!Number.isInteger(idx) || idx < 1 || idx > 24) {
        throw new Error('dataIndex 必須是 1~24 的整數');
    }

    const value = String(name ?? '');

    await dbService.setField('rooms', roomID, 'imageNames', value, idx);
    console.log(`資料庫imageNames[${idx}] 已更新為: ${value}`);

    nameContainer.textContent = await dbService.getField('rooms', roomID, 'imageNames', idx)
    console.log(`本地端imageNames[${idx}] 已更新為: ${value}`);
    // updateAll();


}


// 抓房號創建房間物件
function setRoomIdFromURL() {
    const params = new URLSearchParams(window.location.search);
    roomID = params.get('room'); // 取得 room=xxx 中的 xxx

    if (roomID) {
        document.getElementById('room-id').textContent = `房號：${roomID}`;
        initializing();
    }
}


// 下載所有圖檔姓名資料 更新目標 準備
async function updateAll() {
    if (!dbService) throw new Error('dbService 尚未初始化');

    const [namesRemote, urlsRemote] = await Promise.all([
        dbService.getField('rooms', roomID, 'imageNames'),
        dbService.getField('rooms', roomID, 'imageUrls'),
    ]);

    for (let i = 0; i < 24; i++) {

        const index = i + 1;
        const cardItem = document.querySelector(`.card-item[data-index="${index}"]`); // 對應第 i+1 格
        if (!cardItem) continue;

        // 名稱：遠端 vs 本地
        const nameRemote = (namesRemote?.[i] ?? '').trim();
        const nameEl = cardItem.querySelector('.name');
        const inputEl = cardItem.querySelector('.name-input');
        if (nameEl) {
            const nameLocal = (nameEl.textContent ?? '').trim();
            if (nameRemote !== nameLocal) {
                nameEl.textContent = nameRemote;
                // inputEl.value = nameRemote;
                console.log(`更新第${index}張卡片的名字為${nameEl.textContent}`);
            }

        }


        // 圖片：一律使用 background-image
        try {
            let urlRemote = await storageService.fetchImage(index);

            // 如果拿到null，就用預設圖
            if (urlRemote === null) {
                urlRemote = 'sources/photo.webp';

            }

            const imgEl = cardItem.querySelector('.card-img');
            if (!imgEl || !urlRemote) return;

            const bg = (imgEl.style.backgroundImage || '').trim();
            const m = /^url\((['"]?)(.*?)\1\)$/.exec(bg);
            const urlLocal = m ? m[2] : '';

            let same = false;
            if (urlLocal) {
                const a = new URL(urlRemote, location.href);
                const b = new URL(urlLocal, location.href);
                same = a === b;
            }

            if (!same) {
                imgEl.style.backgroundImage = `url("${urlRemote}")`;
                console.log(`更新第${index}張卡片的圖片`);
            } else {
                console.log(`第${index}張卡片的圖片不用變更`);
            }
        } catch (err) {
            // fetchImage 找不到或權限錯誤都會來這
            // console.warn('fetchImage 失敗：', index, err);
        }

    }


    //  我的目標資訊:
    updateTarget();

    //更新準備按鈕
    const btn = document.getElementById('room-state');
    if (await dbService.getField('rooms', roomID, 'isPlaying')) {
        stateChange('遊戲開始');
    } else if (!await dbService.getField('rooms', roomID, isReady)) {
        stateChange('尚未準備');
    } else {
        stateChange('已準備');
    }

    //更新回合按鈕
    if (!await dbService.getField('rooms', roomID, 'isPlaying')) {
        turnChange(null);
    } else if (await dbService.getField('rooms', roomID, 'currentTurn') === myTurn) {
        turnChange(myTurn);
    } else {
        turnChange(enemyTurn);
    }
    // 更新myGuessed
    // myGuessed = false;

}

// 離開房間
function leaveRoom() {
    window.location.href = `home.html`;
}







// "圖片介面"點擊事件
async function cardImg(e) {
    let img = e.target;
    if (!img.classList.contains('card-img')) {
        img = img.closest('.card-img');
    }


    const parentCard = img.closest('.card-item');
    if (!await dbService.getField('rooms', roomID, 'isPlaying')) {

        const imgName = parentCard.querySelector('.card-img-name');

        img.style.display = 'none';
        imgName.style.display = 'flex';

        hidecurrentInterface(e, '.card-img-name');
        RWDupdateCard(e, '.card-img-name-img', '.card-img-name-name');
    } else {

        const gusesFold = parentCard.querySelector('.card-guess-fold');

        img.style.display = 'none';
        gusesFold.style.display = 'flex';

        hidecurrentInterface(e, '.card-guess-fold');
        RWDupdateCard(e, '.card-guess-fold-img', '.card-guess-fold-name');
    }


}

// "蓋牌介面"點擊事件
function cardFolded(e) {
    const currentInterface = e.target;
    const parentCard = currentInterface.closest('.card-item');
    const img = parentCard.querySelector('.card-img');

    currentInterface.style.display = 'none';
    img.style.display = 'flex';

}

// "猜測蓋牌介面"點擊事件
function cardGuessFold(e) {
    const currentInterface = e.target;
    const parentCard = currentInterface.closest('.card-item');
    const img = parentCard.querySelector('.card-img');

    currentInterface.style.display = 'none';
    img.style.display = 'flex';

}

// "改圖改名介面"點擊事件
function cardImgName(e) {
    const currentInterface = e.target;
    const parentCard = currentInterface.closest('.card-item');
    const img = parentCard.querySelector('.card-img');

    currentInterface.style.display = 'none';
    img.style.display = 'flex';

}

// 點擊其他已開介面區域就自動隱藏介面
function hidecurrentInterface(e, currentInterfaceClass) {
    const currentInterface = e.target;
    const parentCard = currentInterface.closest('.card-item');
    const hidedcurrentInterface = parentCard.querySelector(`${currentInterfaceClass}`);
    const img = parentCard.querySelector('.card-img');
    console.log("觸發自動隱藏介面");

    // 加入一次性的 click 監聽器
    function onNextClick(ev) {
        const clickedInside = ev.target.closest('.card-item') === parentCard;

        if (!clickedInside) {
            hidedcurrentInterface.style.display = 'none';
            img.style.display = 'flex';
            console.log("確定隱藏介面");
        } else {
            console.log("不用隱藏介面");
        }

        // 移除這個一次性監聽器
        window.removeEventListener('click', onNextClick);

    }

    // 延遲一點點加上事件，避免點擊當下就觸發關閉
    setTimeout(() => {
        window.addEventListener('click', onNextClick);
    }, 0);
}






//編輯資訊
function edit(e) {
    e.stopPropagation();
    const target = e.target;
    const parentElement = target.parentElement;
    const parentCard = target.closest('.card-item');
    const imgName = parentCard.querySelector('.card-img-name');

    parentElement.style.display = "none";
    imgName.style.display = "flex";
    console.log("編輯資訊");
}

//蓋牌
function fold(e) {
    e.stopPropagation();
    const parentCard = e.target.closest('.card-item');
    const CardGuessFold = parentCard.querySelector('.card-guess-fold');
    const folded = parentCard.querySelector('.card-folded');
    // const img = parentCard.querySelector('.card-img');

    // img.style.display = "none";
    CardGuessFold.style.display = "none";
    folded.style.display = "flex";
    console.log("蓋上圖片");
}

//猜目標
async function guess(e) {
    e.stopPropagation();

    if (await dbService.getField('rooms', roomID, myGuessed) === true) {
        alert("一回合只能猜一次");
        return;
    }

    if (await dbService.getField('rooms', roomID, 'currentTurn') === myTurn) {
        const target = e.target;
        const parentCard = target.closest('.card-item');
        const guess = Number(parentCard.dataset.index);
        const enemyGuess = await dbService.getField('rooms', roomID, enemyTarget);
        await dbService.setField('rooms', roomID, myGuessed, true);
        if (guess === enemyGuess) {
            // alert("你贏了");
            // resetRoom();
            await dbService.setField('rooms', roomID, 'isPlaying', false);
            await dbService.setField('rooms', roomID, 'winner', myseat);

        } else {
            alert("猜錯了");
            // turnChange(enemyTurn);
        }
    } else {
        alert("現在是敵方回合不能猜目標");
        console.log("不能猜目標");
    }



}

// 保留圖片重整房間
async function resetRoom() {

    turnChange(null);
    await dbService.setField('rooms', roomID, 'targetA', 0);
    await dbService.setField('rooms', roomID, 'targetB', 0);
    updateTarget();
    stateChange('尚未準備');

    await dbService.show('rooms', roomID);
    console.log("檢查重設房間");
}


//改圖
let cropper;
let currentCardImgContainer = null;
let imgIndex;

async function uploadImg(e) {
    e.stopPropagation();
    console.log("改圖觸發");

    const fileInput = e.target;
    const cropContainer = document.getElementById('crop-container');
    const cropArea = document.getElementById('crop-area');
    const cropBtn = document.getElementById('crop-btn');


    // 找到最接近的 .card-img 容器
    const parantElement = fileInput.closest('.card-item');
    const cardImgContainer = parantElement.querySelector('.card-img');
    imgIndex = Number(parantElement.dataset.index);
    if (!cardImgContainer) {
        console.warn('找不到 .card-img 容器');
        return;
    }
    currentCardImgContainer = cardImgContainer;

    const file = fileInput.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = function (event) {
        cropArea.src = event.target.result;
        cropContainer.style.display = 'flex';

        cropArea.onload = () => {
            if (cropper) cropper.destroy();
            cropper = new Cropper(cropArea, {
                aspectRatio: 1,
                viewMode: 1
            });
        };
    };

    reader.readAsDataURL(file);

    fileInput.value = "";//清空inputput讓同圖也會觸發 change
}
// 綁定所有 file-input
document.querySelectorAll('.file-input').forEach(input => {
    input.addEventListener('change', uploadImg);
});
// 綁訂所有裁切按鈕邏輯
document.getElementById('crop-btn').addEventListener('click', function (e) {

    const canvas = cropper.getCroppedCanvas({ width: 300, height: 300 });

    canvas.toBlob((blob) => {
        (async () => {
            const url = URL.createObjectURL(blob);
            currentCardImgContainer.style.backgroundImage = `url(${url})`;
            document.getElementById('crop-container').style.display = 'none';


            try {
                await storageService.uploadImage(imgIndex, blob);
                console.log('✅ 裁切後已上傳');

            } catch (err) {
                console.error('❌ 上傳裁切圖失敗', err);
            }
            console.log(`${currentCardImgContainer.style.backgroundImage}`);
            currentCardImgContainer.style.backgroundImage = `url(${await storageService.fetchImage(imgIndex)})`;


            cropper.destroy();
            imgIndex = 0;
            cropper = null;
            currentCardImgContainer = null;
        })();
    }, 'image/jpeg', 0.7);


});



//改名
const editors = document.querySelectorAll('.name-editor');

editors.forEach(container => {
    // const btn = container.querySelector('.change-name');
    const input = container.querySelector('.name-input');
    const parentElement = container.closest('.card-item');
    const dataIndex = parentElement.getAttribute('data-index');
    const nameContainer = parentElement.querySelector('.name');
    const currentInterface = parentElement.querySelector('.card-img-name');
    const img = parentElement.querySelector('.card-img');

    container.addEventListener('click', (e) => {
        e.stopPropagation();
        console.log("改名");

        container.querySelector('span').textContent = '';
        input.style.display = 'inline-block';
        input.focus();

    });

    input.addEventListener('blur', () => {
        container.style.display = 'inline-block';
        input.style.display = 'none';

        nameContainer.textContent = input.value;//這裡要改
        updateName(dataIndex, input.value, nameContainer);

        container.querySelector('span').textContent = '更改姓名';

        currentInterface.style.display = 'none';
        img.style.display = 'flex';
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {

            input.blur();
        }
    });
});

// 準備確認
async function toggleReady() {
    const btn = document.getElementById('room-state');
    if (await dbService.getField('rooms', roomID, myTarget) === 0) {
        alert("請先選目標");
        return;
    }
    // 判斷目前狀態
    if (btn.textContent === '尚未準備') {
        stateChange('已準備');
        if (await dbService.getField('rooms', roomID, enemyIsReady)) {
            await dbService.setField('rooms', roomID, 'isPlaying', true);
        }

    } else {
        stateChange('尚未準備');
    }
}

// 狀態按鈕三態變換
async function stateChange(state) {
    const btn = document.getElementById('room-state');
    // 判斷目前狀態
    if (state === '尚未準備') {
        await dbService.setField('rooms', roomID, 'isPlaying', false);//這裡把isPlaying關掉
        btn.textContent = '尚未準備';
        await dbService.setField('rooms', roomID, isReady, false);
        btn.disabled = false;
        btn.style.cursor = "pointer";
        btn.style.backgroundColor = "#4CAF50";

    } else if (state === '已準備') {

        btn.textContent = '已準備';
        btn.style.backgroundColor = "#2f6a31ff";
        await dbService.setField('rooms', roomID, isReady, true);
        // btn.disabled = false;
        // btn.style.cursor = "pointer"


    } else if (state === '遊戲開始') {

        btn.textContent = "遊戲開始";
        btn.disabled = true;
        btn.style.cursor = "default";
        btn.style.backgroundColor = "#959593ff";
        // await dbService.setField('rooms', roomID, 'isPlaying', true);
        console.log('雙方都準備，isPlaying改true');

    } else {
        console.log("三態變換錯誤");
    }
}




// 重整房間 壞掉
async function changeState() {

    await dbService.setRoom(roomID);
    await StorageService.cleanRoom();

}


// 點擊顯示我的目標
const overlay = document.getElementById('target-overlay');
function showMyTarget() {
    updateTarget();
    overlay.hidden = false; document.body.style.overflow = 'hidden';
}
function hideTarget() {
    overlay.hidden = true; document.body.style.overflow = '';

}

overlay.addEventListener('click', e => { if (e.target === overlay) hideTarget(); });
addEventListener('keydown', e => { if (e.key === 'Escape') hideTarget(); });


// 選擇目標
async function choseTarget(e) {
    e.stopPropagation();

    const parentCard = e.target.closest('.card-item');
    if (!parentCard) return; // 保護：避免找不到卡片時出錯

    // 取得卡片的 data-index
    const index = Number(parentCard.dataset.index);

    // 更新資料庫 target
    await dbService.setField('rooms', roomID, myTarget, index);
    updateTarget();
    console.log(`${myTarget}設為卡片${index}`)
}

//更新目標
async function updateTarget() {


    const targetImgEl = document.getElementById('target-img');
    const targetNameEl = document.getElementById('target-name');


    // 取得卡片的 data-index
    const index = await dbService.getField('rooms', roomID, myTarget);
    if (index === 0) {
        targetImgEl.style.backgroundImage = 'url("sources/photo.webp")';
        targetNameEl.textContent = '請選擇目標';
        return
    }

    // 從資料庫抓取對應圖片與名稱
    const imgUrl = await storageService.fetchImage(index);
    const nameValue = await dbService.getField('rooms', roomID, 'imageNames', index);


    // 更新 DOM 顯示（改為背景圖片）
    targetImgEl.style.backgroundImage = imgUrl ? `url(${imgUrl})` : '';
    targetNameEl.textContent = nameValue || '';
}


// 偵測isplaying
// 本地要做的事（自己換成你的實作）
async function onGameStart() {
    stateChange('遊戲開始');
    const randomturn = Math.random() < 0.5 ? 'A' : 'B';
    turnChange(randomturn);

    updateAll();//確保圖檔都有下載到本地
    console.log('[isPlaying] → true，開打！'); /* startGame() */

}
async function onGameStop() {

    if (await dbService.getField('rooms', roomID, 'winner') == myseat) {
        alert("你贏了");
    } else {
        alert("你輸了");
    }
    await dbService.setField('rooms', roomID, 'winner', null);
    resetRoom();

    console.log('[isPlaying] → false，收工');  /* stopGame() */
}

/**
 * 以 dbService 監控 Firestore 的 isPlaying（無需任何 import）
 * @param {string} roomID
 * @param {object} opt { interval: 輪詢毫秒數, immediate: 是否第一次就觸發一次, onStart: fn, onStop: fn }
 * @returns {function} stop() 可停止監控
 */
function watchIsPlaying(roomID, opt = {}) {
    const { interval = 1000, immediate = false, onStart = onGameStart, onStop = onGameStop } = opt;

    let firstCheck = true;
    let stopped = false;
    let lastVal;

    const tick = async () => {
        if (stopped) return;
        try {
            const val = !!(await dbService.getField('rooms', roomID, 'isPlaying'));
            if (firstCheck) {
                lastVal = val;
                firstCheck = false;
                if (immediate) val ? onStart() : onStop();
            } else if (val !== lastVal) {
                lastVal = val;
                val ? onStart() : onStop();
            }
            console.log('遊戲狀態偵測循環');
        } catch (e) {
            console.error('[watchIsPlaying] 讀取失敗：', e);
        } finally {
            if (!stopped) setTimeout(tick, interval);
        }
    };

    tick();
    return function stop() { stopped = true; };
}
// 需要時停止監控：stopIsPlaying();


// 回合按鈕案和顯示三態變換
async function turnChange(turn) {
    const btn = document.getElementById('end-turn');
    const turnEl = document.getElementById('turn');


    // 判斷目前狀態
    if (turn === myTurn) {
        await dbService.setField('rooms', roomID, 'currentTurn', myTurn);
        btn.disabled = false;
        btn.style.cursor = "pointer";
        btn.style.backgroundColor = "  #4CAF50";
        turnEl.textContent = "：我的回合";
        console.log("回合切換為：我方回合");
        // await dbService.setField('rooms', roomID, myGuessed, false);

    } else if (turn === enemyTurn) {

        await dbService.setField('rooms', roomID, 'currentTurn', enemyTurn);
        btn.disabled = true;
        btn.style.cursor = "default";
        btn.style.backgroundColor = "#2f6a31ff";
        turnEl.textContent = "：敵方回合";
        console.log("回合切換為：敵方回合")
        await dbService.setField('rooms', roomID, myGuessed, false);

    } else if (turn === null) {

        await dbService.setField('rooms', roomID, 'currentTurn', null);
        btn.disabled = true;
        btn.style.cursor = "default";
        btn.style.backgroundColor = "#2f6a31ff";
        turnEl.textContent = "：選擇目標按下準備";
        console.log("回合切換為：null")
    } else {
        console.log("三態變換錯誤");
    }
}


// 結束回合
// async function endTurn() {
//     turnChange(enemyTurn);
// }

async function changeTurnToA() {
    if (myTurn === "A") {
        turnChange(myTurn);
    }
}
async function changeTurnToB() {
    if (myTurn === "B") {
        turnChange(myTurn);
    }
}

/**
 * 以 dbService 監控 Firestore 的 currentTurn
 * @param {string} roomID
 * @param {object} opt { interval: 輪詢毫秒數, immediate: 第一次就依狀態觸發, onA: fn, onB: fn }
 * @returns {function} stop() 可停止監控
 */
function watchCurrentTurn(roomID, opt = {}) {
    const {
        interval = 1000,
        immediate = false,
        onA = changeTurnToA,
        onB = changeTurnToB
    } = opt;

    let firstCheck = true;
    let stopped = false;
    let lastVal;

    const tick = async () => {
        if (stopped) return;
        try {
            const raw = await dbService.getField('rooms', roomID, 'currentTurn');
            const val = (raw === 'A' || raw === 'B') ? raw : null;

            if (firstCheck) {
                firstCheck = false;
                lastVal = val;
                if (immediate && val) (val === 'A' ? onA : onB)();
            } else if (val !== lastVal) {
                lastVal = val;
                if (val === 'A') onA();
                else if (val === 'B') onB();
                // val 為 null/其他值時不觸發
            }
            console.log('[watchCurrentTurn] 偵測循環');
        } catch (e) {
            console.error('[watchCurrentTurn] 讀取失敗：', e);
        } finally {
            if (!stopped) setTimeout(tick, interval);
        }
    };

    tick();
    return function stop() { stopped = true; };
}

// 下載中

function showLoading() {
    document.getElementById("loading-overlay").style.display = "flex";
}

function hideLoading() {
    document.getElementById("loading-overlay").style.display = "none";
}

async function handleUpdateAll() {
    try {
        // showLoading();//標記
        await updateAll();
    } finally {
        // hideLoading();
    }
}


// 手機排版
document.addEventListener('DOMContentLoaded', () => {
    // 先檢查一次
    if (window.innerWidth < 600) {



        // document.querySelectorAll('.card-img-name').forEach(el => {
        //   // 確保不會一直重複加
        //   if (!el.querySelector('img')) {
        //     const img = document.createElement('img');
        //     img.alt = ''; // 空的就好
        //     el.appendChild(img);
        //   }
        // });
    }
})

function RWDImgDisappear(e, currentInterfaceClass) {
    e.stopPropagation();
    const currentInterface = e.target.closest(currentInterfaceClass);
    const parentCard = currentInterface.closest('.card-item');
    const img = parentCard.querySelector('.card-img');


    currentInterface.style.display = 'none';
    img.style.display = 'flex';
}

// 改資訊介面的顯示圖片更新
function RWDupdateCard(e, imgPastedClass, namePastedClass) {
    // 找到父層 .card-Item
    const parent = e.target.closest('.card-item');
    if (!parent) return;
    // 複製來源
    const imgCopied = parent.querySelector('.card-img');
    const nameCopied = parent.querySelector('.name');

    // 貼上目標
    const imgPasted = parent.querySelector(imgPastedClass);
    const namePasted = parent.querySelector(namePastedClass);
    console.log(imgPasted.style.backgroundImage);

    if (imgCopied && imgPasted) {
        imgPasted.style.backgroundImage = imgCopied.style.backgroundImage || '';

    }

    if (nameCopied && namePasted) {
        // 文字內容是 innerText / textContent，不是 .context
        namePasted.textContent = nameCopied.textContent || '';

    }
}

