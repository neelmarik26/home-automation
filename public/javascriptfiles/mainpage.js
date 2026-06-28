console.log("IoT Home Automation — script loaded");

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

    try {
        const response = await fetch('/user/button-status', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json',Authorization:`Bearer ${token}` }
        });
        const result = await response.json();
        console.log('Server replied:', result);

        if (result.button1 == 1) setCardState(document.getElementById('card1'), document.getElementById('buttonid1'), true);
        if (result.button2 == 1) setCardState(document.getElementById('card2'), document.getElementById('buttonid2'), true);
        if (result.button3 == 1) setCardState(document.getElementById('card3'), document.getElementById('buttonid3'), true);
        if (result.button4 == 1) setCardState(document.getElementById('card4'), document.getElementById('buttonid4'), true);
    } catch (err) {
        console.error('Failed to fetch initial state:', err);
    }
});

/* ─────────────────────────────────────────────
   Send updated device state to backend
───────────────────────────────────────────────*/
async function senddatatobackend(data) {
    try {
        const response = await fetch('/mainpagedata', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        console.log('Server replied:', result);
    } catch (err) {
        console.error('Failed to send data to backend:', err);
    }
}

/* ─────────────────────────────────────────────
   Verify token with server
───────────────────────────────────────────────*/
async function verifytoken() {
    try {
        const usertoken = window.localStorage.getItem('token');
        const response = await fetch('/mainpagetoken', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usertoken })
        });
        const result = await response.json();
        console.log('Token verify:', result.message);
        return result.message;
    } catch (err) {
        console.error('Token verification failed:', err);
        return 'token is not found';
    }
}

/* ─────────────────────────────────────────────
   Generic card toggle handler
   Works for all 4 devices — pass card number
───────────────────────────────────────────────*/
async function handleCardToggle(cardNum) {
    const card   = document.getElementById('card' + cardNum);
    const button = document.getElementById('buttonid' + cardNum);
    const isNowOn = button.textContent === 'off';

    // 1. Update UI instantly — no waiting
    setCardState(card, button, isNowOn);

    // 2. Verify + sync in background
    try {
        const message = await verifytoken();
        if (message === 'token is not found') {
            setCardState(card, button, !isNowOn); // roll back
            window.localStorage.removeItem('token');
            window.location.href = '/';
            return;
        }
        await senddatatobackend({ id: 'btn' + cardNum, status: isNowOn ? 1 : 0 });
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

/* ─────────────────────────────────────────────
   Admin panel
───────────────────────────────────────────────*/
const admintoken = "68fda25b462f5ecf5bf4374e"; // change for new admin

document.getElementById('adminbtn').addEventListener('click', async function () {
    if (window.localStorage.getItem('token') === admintoken) {
        // Clear old list
        document.getElementById('userList').innerHTML = '';
        // Show popup using class (matches CSS `.pop.open`)
        document.getElementById('popup').classList.add('open');

        const users = await alluserinfo();
        document.getElementById('userCount').textContent = users.length;

        users.forEach(function (user) {
            const words       = user.name.trim().split(' ');
            const firstLetter = words[0][0].toUpperCase();
            const lastLetter  = words[words.length - 1][0].toUpperCase();
            const initials    = firstLetter + lastLetter;

            if (admintoken !== user._id) {
                // Regular user card
                document.getElementById('userList').innerHTML +=
                    `<div class="user-card">
                        <div class="user-avatar">${initials}</div>
                        <div class="user-info">
                            <div class="user-name">${user.name}</div>
                            <div class="user-email">${user.email}</div>
                        </div>
                        <div class="user-actions">
                            <button class="delete-btn" onclick="deleteUser('${user._id}', this)" title="Delete user">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/>
                                </svg>
                            </button>
                        </div>
                        <div class="user-status"></div>
                    </div>`;
            } else {
                // Admin card — no delete button
                document.getElementById('userList').innerHTML +=
                    `<div class="user-card">
                        <div class="user-avatar">${initials}</div>
                        <div class="user-info">
                            <div class="user-name">${user.name}</div>
                            <div class="user-email">${user.email}</div>
                        </div>
                        <div class="adminsng">Admin</div>
                        <div class="user-status"></div>
                    </div>`;
            }
        });
    } else {
        alert('This feature is coming soon');
    }
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

async function deleteUser(userid, btn) {
    try {
        const response = await fetch('/userdeleatbyid', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userid })
        });
        const result = await response.json();
        console.log(result.message);

        if (result.action === 'deleat') {
            const card = btn.closest('.user-card');
            if (card) card.remove();
            const countEl = document.getElementById('userCount');
            countEl.textContent = parseInt(countEl.textContent) - 1;
        }
    } catch (err) {
        console.error('Failed to delete user:', err);
    }
}

/* ─────────────────────────────────────────────
   About Us
───────────────────────────────────────────────*/
document.getElementById('about_us').addEventListener('click', function () {
    alert('This feature is coming soon');
});

/* ─────────────────────────────────────────────
   WiFi credential change
───────────────────────────────────────────────*/
function changeespwifi() {
    closePopup();
    document.getElementById('ssid').value = '';
    document.getElementById('ssidpasspassword').value = '';
    document.getElementById('wifipassheding').textContent = 'Change ESP WiFi Credentials';
    document.getElementById('wifipass').classList.add('active');
}

function closeWifiPopup() {
    document.getElementById('wifipass').classList.remove('active');
}

document.getElementById('changewifi').addEventListener('click', async function (e) {
    e.preventDefault();

    const ssid     = document.getElementById('ssid').value.trim();
    const password = document.getElementById('ssidpasspassword').value.trim();

    if (!ssid || !password) {
        document.getElementById('wifipassheding').textContent = 'Please fill in both fields.';
        return;
    }

    document.getElementById('changewifi').disabled = true;
    console.log('New SSID:', ssid);

    try {
        const response = await fetch('/esp_cpass', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ssid, password })
        });
        const result = await response.json();

        if (result.message === 'esp is not connected') {
            document.getElementById('changewifi').disabled = false;
            document.getElementById('wifipassheding').textContent = 'ESP is not connected. Please try again later.';
        } else if (result.message === 'esp pass word change request sent') {
            document.getElementById('wifipassheding').textContent = 'Request sent! ESP will apply new WiFi settings shortly.';
            setTimeout(function () {
                document.getElementById('changewifi').disabled = false;
                closeWifiPopup();
            }, 5000);
        } else if (result.error) {
            document.getElementById('changewifi').disabled = false;
            document.getElementById('wifipassheding').textContent = 'Error: ' + result.error;
        }
    } catch (err) {
        document.getElementById('changewifi').disabled = false;
        document.getElementById('wifipassheding').textContent = 'Network error. Please try again.';
        console.error('WiFi change failed:', err);
    }
});