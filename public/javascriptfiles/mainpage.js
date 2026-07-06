console.log("IoT Home Automation — script loaded");

/* ─────────────────────────────────────────────
   ESP Status Tracking
───────────────────────────────────────────────*/
let userWs = null;
let espStatus = 'OFFLINE';

function updateEspStatusIndicator(status) {
    const dot = document.getElementById('espStatusDot');
    const text = document.getElementById('espStatusText');
    if (!dot || !text) return;

    espStatus = status;
    if (status === 'ONLINE') {
        dot.style.background = '#00d4aa';
        text.textContent = 'ESP online';
    } else {
        dot.style.background = '#ff4757';
        text.textContent = 'ESP offline';
    }
}

function connectUserWs() {
    const token = window.localStorage.getItem('token');
    if (!token || typeof WebSocket === 'undefined') {
        return;
    }

    const socketProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    userWs = new WebSocket(`${socketProtocol}//${window.location.host}/ws-front?token=${token}`);

    userWs.addEventListener('open', function () {
        console.log('Frontend WebSocket connected');
    });

    userWs.addEventListener('message', function (event) {
        try {
            const payload = JSON.parse(event.data);
            console.log('WS payload:', payload);

            // Handle ping/pong for heartbeat
            if (payload.type === 'ping') {
                userWs.send(JSON.stringify({ type: 'pong' }));
                return;
            }

            if (payload.type === 'esp_status') {
                updateEspStatusIndicator(payload.status);
            }

            if (payload.type === 'connected') {
                console.log('Connected to WS, userId:', payload.userId);
                // Set initial ESP status from connection response
                if (payload.espStatus) {
                    updateEspStatusIndicator(payload.espStatus);
                }
            }
        } catch (error) {
            console.error('WebSocket message parse failed:', error);
        }
    });

    userWs.addEventListener('close', function (event) {
        console.log('Frontend WebSocket disconnected, code:', event.code, 'reason:', event.reason);
        userWs = null;
        // Only show offline if it wasn't a clean close (code 1000) or normal reconnect
        if (event.code !== 1000 && event.code !== 1001) {
            updateEspStatusIndicator('OFFLINE');
        }
        // Reconnect after 3 seconds
        setTimeout(connectUserWs, 3000);
    });

    userWs.addEventListener('error', function (error) {
        console.error('WebSocket error:', error);
    });
}

/* ─────────────────────────────────────────────
   Helper: update the "X devices active" counter
───────────────────────────────────────────────*/
function updateDeviceCount() {
    const total = document.querySelectorAll('.card.on').length;
    const el = document.getElementById('devicesOnCount');
    if (!el) return;
    if (total === 0) {
        el.textContent = 'No devices active';
    } else {
        el.textContent = total + (total === 1 ? ' device active' : ' devices active');
    }
}

/* ─────────────────────────────────────────────
   Helper: set a card's visual ON / OFF state
   and sync the hidden <button> text for
   backwards-compatible backend calls
───────────────────────────────────────────────*/
function setCardState(cardEl, buttonEl, isOn) {
    if (isOn) {
        cardEl.classList.add('on');
        buttonEl.textContent = 'on';
        cardEl.querySelector('.card-status').textContent = 'On';
    } else {
        cardEl.classList.remove('on');
        buttonEl.textContent = 'off';
        cardEl.querySelector('.card-status').textContent = 'Off';
    }
    updateDeviceCount();
}

function bindButtonRecord(cardEl, buttonEl, buttonRecord) {
    if (!cardEl || !buttonEl || !buttonRecord) return;
    buttonEl.dataset.buttonId = buttonRecord._id;
    buttonEl.dataset.userId = buttonRecord.userId;
    cardEl.dataset.buttonId = buttonRecord._id;
    cardEl.dataset.userId = buttonRecord.userId;
}

function applyButtonRecordToCard(buttonRecord, index) {
    if (!buttonRecord) return;

    const card = document.getElementById('card' + index);
    const button = document.getElementById('buttonid' + index);

    bindButtonRecord(card, button, buttonRecord);
    setCardState(card, button, buttonRecord.state == 1);
}

function syncAllButtons(buttons) {
    const list = Array.isArray(buttons) ? buttons : [];

    if (list.length !== 4) {
        return;
    }

    applyButtonRecordToCard(list[0], 1);
    applyButtonRecordToCard(list[1], 2);
    applyButtonRecordToCard(list[2], 3);
    applyButtonRecordToCard(list[3], 4);

    const activeCount = list.filter((button) => button?.state == 1).length;
    const devicesOnCount = document.getElementById('devicesOnCount');
    if (devicesOnCount) {
        devicesOnCount.textContent = activeCount + (activeCount === 1 ? ' device active' : ' devices active');
    }
}

/* ─────────────────────────────────────────────
   On load: check auth token, then fetch
   current device states from the server
───────────────────────────────────────────────*/
window.addEventListener('DOMContentLoaded', async function () {
    const token = window.localStorage.getItem('token');
    if (!token) {
        window.location.href = '/';
        return;
    }
    const user=JSON.parse(window.localStorage.getItem('user'));
    document.getElementById("user-name").innerHTML=`welcome ${user.name} Id:${user.id}`

    // Connect to WebSocket for ESP status updates
    connectUserWs();

    try {
        const response = await fetch('/user/button-status', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json',Authorization:`Bearer ${token}` }
        });
        const result = await response.json();
        syncAllButtons(Array.isArray(result.buttons) ? result.buttons : []);
        
    } catch (err) {
        console.error('Failed to fetch initial state:', err);
    }
});

/* ─────────────────────────────────────────────
   Send updated device state to backend
───────────────────────────────────────────────*/
async function senddatatobackend(data) {
    try {
        if (!data.buttonId) {
            throw new Error('buttonId is required');
        }
         const token = window.localStorage.getItem('token');
        if (!token) {
            window.location.href = '/';
            return;
        }

        const response = await fetch(`/user/button-status/${data.buttonId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json',Authorization:`Bearer ${token}`  },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        console.log('Server replied:', result);
    } catch (err) {
        console.error('Failed to send data to backend:', err);
    }
}



/* ─────────────────────────────────────────────
   Generic card toggle handler
   Works for all 4 devices — pass card number
───────────────────────────────────────────────*/
async function handleCardToggle(cardNum) {
    const card   = document.getElementById('card' + cardNum);
    const button = card?.querySelector('.stylish-btn') || document.getElementById('buttonid' + cardNum);
    const buttonId = card?.dataset.buttonId || button?.dataset.buttonId || button?.id;

    if (!card || !button) {
        console.error('Missing card or button element for card', cardNum);
        return;
    }
    const isNowOn = button.textContent === 'off';

    // 1. Update UI instantly — no waiting
    setCardState(card, button, isNowOn);

    // 2. Verify + sync in background
    try {
        await senddatatobackend({ buttonId, status: isNowOn ? 1 : 0 });
    } catch (err) {
        setCardState(card, button, !isNowOn); // roll back on network error
        console.error('Sync failed, reverting:', err);
    }
}

/* ── Attach click listeners to all 4 cards ── */
[1, 2, 3, 4].forEach(function (n) {
    document.getElementById('card' + n).addEventListener('click', function () {
        handleCardToggle(n);
    });
});

/* ─────────────────────────────────────────────
   Logout
───────────────────────────────────────────────*/
document.getElementById('logout').addEventListener('click', function () {
    window.localStorage.removeItem('token');
    window.location.href = '/';
});



function closePopup() {
    document.getElementById('popup').classList.remove('open');
}

async function alluserinfo() {
    try {
        const response = await fetch('/alluserinfo');
        return await response.json();
    } catch (err) {
        console.error('Failed to fetch users:', err);
        return [];
    }
}

/* ─────────────────────────────────────────────
   About Us
───────────────────────────────────────────────*/
document.getElementById('about_us').addEventListener('click', function () {
    alert('This feature is coming soon');
});




