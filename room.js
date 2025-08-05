// 離開房間
function leaveRoom() {
    window.location.href = `home.html`;
}

// 抓房號
function setRoomIdFromURL() {
    const params = new URLSearchParams(window.location.search);
    const roomID = params.get('room'); // 取得 room=xxx 中的 xxx

    if (roomID) {
        document.getElementById('room-id').textContent = `房號：${roomID}`;
    }
}
document.addEventListener('DOMContentLoaded', () => {
    setRoomIdFromURL();
});


let gamePlaying = false;
let myTurn = true;


// "圖片介面"點擊事件
function cardImg(e) {
    const img = e.target;
    const parentCard = img.closest('.card-item');
    if (!gamePlaying) {

        const imgName = parentCard.querySelector('.card-img-name');

        img.style.display = 'none';
        imgName.style.display = 'flex';
    } else {

        const gusesFold = parentCard.querySelector('.card-guess-fold');

        img.style.display = 'none';
        gusesFold.style.display = 'flex';
    }
}

// "蓋牌介面"點擊事件
function cardFolded(e) {
    const interface = e.target;
    const parentCard = interface.closest('.card-item');
    const img = parentCard.querySelector('.card-img');

    interface.style.display = 'none';
    img.style.display = 'flex';

}

// "編輯蓋牌介面"點擊事件
// function cardEditFold(e) {
//     const interface = e.target;
//     const parentCard = interface.closest('.card-item');
//     const img = parentCard.querySelector('.card-img');

//     interface.style.display = 'none';
//     img.style.display = 'flex';

// }

// "猜測蓋牌介面"點擊事件
function cardGuessFold(e) {
    const interface = e.target;
    const parentCard = interface.closest('.card-item');
    const img = parentCard.querySelector('.card-img');

    interface.style.display = 'none';
    img.style.display = 'flex';

}

// "改圖改名介面"點擊事件
function cardImgName(e) {
    const interface = e.target;
    const parentCard = interface.closest('.card-item');
    const img = parentCard.querySelector('.card-img');

    interface.style.display = 'none';
    img.style.display = 'flex';
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

    parentElement.style.display = "none";
    folded.style.display = "flex";
    console.log("蓋上圖片");
}

//猜目標
function guess(e) {
    e.stopPropagation();
    if (myTurn) {
        console.log("猜目標");
    }else{
        alert("現在是敵方回合不能猜目標");
        console.log("不能猜目標");
    }

}

//改圖
function uploadImg(e) {
    e.stopPropagation();
    console.log("改圖");
}

//改名
function changeName(e) {
    e.stopPropagation();
    console.log("改名");
}





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