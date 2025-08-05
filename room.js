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

