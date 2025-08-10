// 初始化創建資料庫跟相關function

let dbService;
let roomID;
document.addEventListener('DOMContentLoaded', () => {
    setRoomIdFromURL();
});

function initializing() {
    (async () => {
        try {
            const moduleObj = await import('./data.js');
            dbService = moduleObj.dbService; // 這裡才載入 module

            let isOpened = await dbService.getField('rooms', roomID, 'isOpened');
            if (!isOpened == true) {
                await dbService.setRoom(roomID);
            }
            await dbService.show('rooms', roomID);
            updateAll();
            // await dbService.setField('rooms', '1126','imageNames',12<'哈哈');
        } catch (e) {
            console.error('載入 db 模組失敗：', e);
        }
    })();
}

//更新名子(上傳下載) 
async function updateName(dataIndex, name, nameContainer) {

    if (!dbService) throw new Error('dbService 尚未初始化');

    const idx = Number(dataIndex);
    if (!Number.isInteger(idx) || idx < 1 || idx > 24) {
        throw new Error('dataIndex 必須是 1~24 的整數');
    }

    const value = String(name ?? '');

    await dbService.setField('rooms', roomID, 'imageNames', value, idx);
    console.log(`資料庫imageNames[${idx}] 已更新為: ${value}`);

    // nameContainer.textContent = await dbService.getField('rooms', roomID, 'imageNames', idx)
    // console.log(`本地端imageNames[${idx}] 已更新為: ${value}`);
    updateAll();


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


// 下載所有圖檔姓名資料
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
        if (nameEl) {
            const nameLocal = (nameEl.textContent ?? '').trim();
            if (nameRemote !== nameLocal) {
                nameEl.textContent = nameRemote;
                console.log(`更新第${index}張卡片的名字為${nameEl.textContent}`);
            }

        }

        // 圖片：一律使用 background-image
        //     const urlRemote = (urlsRemote?.[i] ?? '').trim();
        //     const imgEl = cardItem.querySelector('.card-img');
        //     if (imgEl && urlRemote) {
        //       const bg = imgEl.style.backgroundImage || '';
        //       const urlLocal = bg.replace(/^url\((['"]?)(.*)\1\)$/,'$2');
        //       if (urlRemote !== urlLocal) imgEl.style.backgroundImage = `url("${urlRemote}")`;
        //     }
        //   }
    }
}


// 檢查所有條件






// 離開房間
function leaveRoom() {
    window.location.href = `home.html`;
}




let gamePlaying = false;
let myTurn = true;


// "圖片介面"點擊事件
function cardImg(e) {
    let img = e.target;
    if (!img.classList.contains('card-img')) {
        img = img.closest('.card-img');
    }


    const parentCard = img.closest('.card-item');
    if (!gamePlaying) {

        const imgName = parentCard.querySelector('.card-img-name');

        img.style.display = 'none';
        imgName.style.display = 'flex';

        hidecurrentInterface(e, '.card-img-name');
    } else {

        const gusesFold = parentCard.querySelector('.card-guess-fold');

        img.style.display = 'none';
        gusesFold.style.display = 'flex';

        hidecurrentInterface(e, '.card-guess-fold');
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
    const target = e.target;
    const parentElement = target.parentElement;
    const parentCard = target.closest('.card-item');
    const folded = parentCard.querySelector('.card-folded');
    const img = parentCard.querySelector('.card-img');

    // img.style.display = "none";
    parentElement.style.display = "none";
    folded.style.display = "flex";
    console.log("蓋上圖片");
}

//猜目標
function guess(e) {
    e.stopPropagation();
    if (myTurn) {
        console.log("猜目標");
    } else {
        alert("現在是敵方回合不能猜目標");
        console.log("不能猜目標");
    }

}

//改圖
let cropper;
let currentCardImgContainer = null;

function uploadImg(e) {
    e.stopPropagation();
    console.log("改圖觸發");

    const fileInput = e.target;
    const cropContainer = document.getElementById('crop-container');
    const cropArea = document.getElementById('crop-area');
    const cropBtn = document.getElementById('crop-btn');

    // 找到最接近的 .card-img 容器
    const parantElement = fileInput.closest('.card-item');
    const cardImgContainer = parantElement.querySelector('.card-img');
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
        const url = URL.createObjectURL(blob);
        currentCardImgContainer.style.backgroundImage = `url(${url})`;
        document.getElementById('crop-container').style.display = 'none';
        cropper.destroy();
        cropper = null;
        currentCardImgContainer = null;
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

        // nameContainer.textContent = input.value;//這裡要改
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






// 改變遊戲狀態
function changeState(btn) {
    gamePlaying = !gamePlaying;
    btn.textContent = gamePlaying ? "進行中" : "停止中";
    console.log("遊戲狀態切換為：", gamePlaying ? "進行中" : "停止中");
}

// 改變回合
function changeTurn(btn) {
    myTurn = !myTurn;
    btn.textContent = myTurn ? "我的回合" : "敵方回合";
    console.log("回合切換為：", myTurn ? "我的回合" : "敵方回合");
}

// 抓取資料庫並更新



