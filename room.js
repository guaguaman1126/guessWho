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


// "圖片介面"點擊事件
function cardImg(e) {
    if (!gamePlaying) {
        const img = e.target;
        const parentCard = e.target.closest('.card-item');
        const editFold = parentCard.querySelector('.card-edit-fold');

        img.style.display = 'none';
        editFold.style.display = 'flex';
    }
}

// "編輯蓋牌介面"點擊事件
function cardEditFold(e) {
    editFold = e.target;
    const parentCard = editFold.closest('.card-item');
    const img = parentCard.querySelector('.card-img');

    editFold.style.display = 'none';
    img.style.display = 'flex';

}

// "蓋牌介面"點擊事件
function cardFolded(e) {
    folded = e.target;
    const parentCard = folded.closest('.card-item');
    const img = parentCard.querySelector('.card-img');

    folded.style.display = 'none';
    img.style.display = 'flex';

}






function edit(e) {
    e.stopPropagation();
    console.log("編輯圖片");
}

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

