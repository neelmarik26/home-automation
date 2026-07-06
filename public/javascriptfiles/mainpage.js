/* ─────────────────────────────────────────────
   Default device names (fallback)
───────────────────────────────────────────────*/
const DEFAULT_DEVICE_NAMES = {
    'btn1': { name: 'Room 1 Light', room: 'Bedroom' },
    'btn2': { name: 'Room 2 Light', room: 'Bedroom 2' },
    'btn3': { name: 'Dining Light', room: 'Dining Room' },
    'btn4': { name: 'Dining Fan', room: 'Dining Room' }
};

const DEFAULT_DEVICE_ROOMS = {
    'btn1': 'Bedroom',
    'btn2': 'Bedroom 2',
    'btn3': 'Dining Room',
    'btn4': 'Dining Room'
};

/* ─────────────────────────────────────────────
   Custom Alert / Confirm Modal
───────────────────────────────────────────────*/
let alertResolve = null;

function openCustomAlert(title, message, type = 'info') {
    return new Promise((resolve) => {
        const overlay = document.getElementById('customAlertOverlay');
        const titleEl = document.getElementById('customAlertTitle');
        const messageEl = document.getElementById('customAlertMessage');
        const iconEl = document.getElementById('customAlertIcon');
        const okBtn = document.getElementById('customAlertOk');
        const cancelBtn = document.getElementById('customAlertCancel');

        if (!overlay) { resolve(true); return; }

        titleEl.textContent = title;
        messageEl.textContent = message;

        iconEl.className = 'custom-alert-icon';
        if (type === 'error') iconEl.classList.add('error');
        else if (type === 'warn') iconEl.classList.add('warn');

        cancelBtn.style.display = 'none';
        okBtn.textContent = 'OK';
        okBtn.onclick = () => {
            overlay.classList.remove('open');
            resolve(true);
        };

        overlay.classList.add('open');
        alertResolve = resolve;
    });
}

function openCustomConfirm(title, message) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('customAlertOverlay');
        const titleEl = document.getElementById('customAlertTitle');
        const messageEl = document.getElementById('customAlertMessage');
        const iconEl = document.getElementById('customAlertIcon');
        const okBtn = document.getElementById('customAlertOk');
        const cancelBtn = document.getElementById('customAlertCancel');

        if (!overlay) { resolve(false); return; }

        titleEl.textContent = title;
        messageEl.textContent = message;

        iconEl.className = 'custom-alert-icon';
        iconEl.classList.add('warn');

        cancelBtn.style.display = '';
        okBtn.textContent = 'Confirm';
        okBtn.onclick = () => {
            overlay.classList.remove('open');
            resolve(true);
        };
        cancelBtn.onclick = () => {
            overlay.classList.remove('open');
            resolve(false);
        };

        overlay.classList.add('open');
        alertResolve = resolve;
    });
}

// Close alert when clicking overlay background
document.addEventListener('DOMContentLoaded', function () {
    const overlay = document.getElementById('customAlertOverlay');
    if (overlay) {
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay && alertResolve) {
                overlay.classList.remove('open');
                alertResolve(true);
                alertResolve = null;
            }
        });
    }
});

/* ─────────────────────────────────────────────
   Auth helpers
───────────────────────────────────────────────*/
function getToken() {
    return window.localStorage.getItem('token');
}

function getUser() {
    try {
        return JSON.parse(window.localStorage.getItem('user') || '{}');
    } catch {
        return {};
    }
}

function authHeaders() {
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`
    };
}

function isAdminUser() {
    return getUser().type === 'ADMIN';
}

/* ─────────────────────────────────────────────
   Fetch and apply custom device names
───────────────────────────────────────────────*/
async function fetchAndApplyDeviceNames() {
    const token = getToken();
    if (!token) return;

    try {
        const response = await fetch('/user/device-names', {
            method: 'GET',
            headers: authHeaders()
        });
        const result = await response.json();
        if (result.deviceNames || result.deviceRooms) {
            applyDeviceNames(result.deviceNames, result.deviceRooms);
        }
    } catch (err) {
        console.error('Failed to fetch device names:', err);
    }
}

function applyDeviceNames(deviceNames, deviceRooms) {
    for (let i = 1; i <= 4; i++) {
        const card = document.getElementById('card' + i);
        if (!card) continue;

        const buttonName = 'btn' + i;
        const customName = deviceNames?.[buttonName] || DEFAULT_DEVICE_NAMES[buttonName]?.name || '';
        const customRoom = deviceRooms?.[buttonName] || DEFAULT_DEVICE_ROOMS[buttonName] || '';

        const nameEl = card.querySelector('.card-name');
        const roomEl = card.querySelector('.card-room');
        if (nameEl) nameEl.textContent = customName;
        if (roomEl) roomEl.textContent = customRoom;
    }
}

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
    const token = getToken();
    if (!token || typeof WebSocket === 'undefined') return;

    const socketProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    userWs = new WebSocket(`${socketProtocol}//${window.location.host}/ws-front?token=${token}`);

    userWs.addEventListener('open', function () {
        console.log('Frontend WebSocket connected');
    });

    userWs.addEventListener('message', function (event) {
        try {
            const payload = JSON.parse(event.data);
            if (payload.type === 'ping') {
                userWs.send(JSON.stringify({ type: 'pong' }));
                return;
            }
            if (payload.type === 'esp_status') {
                updateEspStatusIndicator(payload.status);
            }
            if (payload.type === 'connected') {
                if (payload.espStatus) {
                    updateEspStatusIndicator(payload.espStatus);
                }
            }
        } catch (error) {
            console.error('WebSocket message parse failed:', error);
        }
    });

    userWs.addEventListener('close', function (event) {
        console.log('Frontend WebSocket disconnected, code:', event.code);
        userWs = null;
        if (event.code !== 1000 && event.code !== 1001) {
            updateEspStatusIndicator('OFFLINE');
        }
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
    el.textContent = total === 0 ? 'No devices active' : total + (total === 1 ? ' device active' : ' devices active');
}

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
    if (list.length !== 4) return;

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
   On load: check auth, render UI
───────────────────────────────────────────────*/
window.addEventListener('DOMContentLoaded', async function () {
    const token = getToken();
    if (!token) {
        window.location.href = '/';
        return;
    }

    const user = getUser();
    document.getElementById('user-name').innerHTML = `welcome ${user.name} Id:${user.id}`;

    if (isAdminUser()) {
        const adminBtn = document.getElementById('adminbtn');
        if (adminBtn) adminBtn.style.display = '';
    }

    connectUserWs();
    await fetchAndApplyDeviceNames();

    try {
        const response = await fetch('/user/button-status', {
            method: 'GET',
            headers: authHeaders()
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
        if (!data.buttonId) throw new Error('buttonId is required');
        const response = await fetch(`/user/button-status/${data.buttonId}`, {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify(data)
        });
        return await response.json();
    } catch (err) {
        console.error('Failed to send data to backend:', err);
        throw err;
    }
}

async function handleCardToggle(cardNum) {
    const card = document.getElementById('card' + cardNum);
    const button = card?.querySelector('.stylish-btn') || document.getElementById('buttonid' + cardNum);
    const buttonId = card?.dataset.buttonId || button?.dataset.buttonId;

    if (!card || !button) return;

    const isNowOn = button.textContent === 'off';
    setCardState(card, button, isNowOn);

    try {
        await senddatatobackend({ buttonId, status: isNowOn ? 1 : 0 });
    } catch (err) {
        setCardState(card, button, !isNowOn);
    }
}

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
    window.localStorage.removeItem('user');
    window.location.href = '/';
});

/* ─────────────────────────────────────────────
   Popup helpers
───────────────────────────────────────────────*/
function closePopup() {
    document.getElementById('popup').classList.remove('open');
}

function closeWifiPopup() {
    document.getElementById('wifipass').classList.remove('open');
}

function changeespwifi() {
    document.getElementById('wifipass').classList.add('open');
}

/* ─────────────────────────────────────────────
   About Us
───────────────────────────────────────────────*/
document.getElementById('about_us').addEventListener('click', function () {
    openCustomAlert('Coming Soon', 'This feature is coming soon.', 'info');
});

/* ─────────────────────────────────────────────
   Device Names Popup
───────────────────────────────────────────────*/
function openDeviceNamesPopup() {
    const popup = document.getElementById('deviceNamesPopup');
    if (!popup) return;

    for (let i = 1; i <= 4; i++) {
        const nameInput = document.getElementById('customName-btn' + i);
        const roomInput = document.getElementById('customRoom-btn' + i);
        const card = document.getElementById('card' + i);
        if (!nameInput || !roomInput || !card) continue;

        const currentName = card.querySelector('.card-name')?.textContent || '';
        const currentRoom = card.querySelector('.card-room')?.textContent || '';
        const defaultName = DEFAULT_DEVICE_NAMES['btn' + i]?.name || '';
        const defaultRoom = DEFAULT_DEVICE_ROOMS['btn' + i] || '';

        nameInput.value = currentName !== defaultName ? currentName : '';
        nameInput.placeholder = defaultName;
        roomInput.value = currentRoom !== defaultRoom ? currentRoom : '';
        roomInput.placeholder = defaultRoom;
    }
    popup.classList.add('open');
}

function closeDeviceNamesPopup() {
    document.getElementById('deviceNamesPopup')?.classList.remove('open');
}

async function saveDeviceNames() {
    const updates = [];
    for (let i = 1; i <= 4; i++) {
        const nameInput = document.getElementById('customName-btn' + i);
        const roomInput = document.getElementById('customRoom-btn' + i);
        const updateData = { buttonName: 'btn' + i };
        let hasChanges = false;

        if (nameInput?.value.trim()) {
            updateData.customName = nameInput.value.trim();
            hasChanges = true;
        }
        if (roomInput?.value.trim()) {
            updateData.customRoom = roomInput.value.trim();
            hasChanges = true;
        }
        if (hasChanges) updates.push(updateData);
    }

    if (updates.length === 0) {
        closeDeviceNamesPopup();
        return;
    }

    try {
        for (const update of updates) {
            const response = await fetch('/user/device-names', {
                method: 'PUT',
                headers: authHeaders(),
                body: JSON.stringify(update)
            });
            if (!response.ok) throw new Error('Failed to update');
        }
        await fetchAndApplyDeviceNames();
        closeDeviceNamesPopup();
        openCustomAlert('Success', 'Device names saved successfully.', 'info');
    } catch (err) {
        console.error('Failed to save device names:', err);
        openCustomAlert('Error', 'Failed to save device names.', 'error');
    }
}

document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('deviceNamesBtn')?.addEventListener('click', openDeviceNamesPopup);
    document.getElementById('saveDeviceNames')?.addEventListener('click', saveDeviceNames);
});

/* ─────────────────────────────────────────────
   ADMIN PANEL
───────────────────────────────────────────────*/
let adminUsers = [];

function openAdminPanel() {
    document.getElementById('popup').classList.add('open');
    refreshAdminUsers();
}

async function refreshAdminUsers() {
    const rowsEl = document.getElementById('adminUserRows');
    if (!rowsEl) return;
    rowsEl.innerHTML = '<div class="admin-loading">Loading users...</div>';

    try {
        const response = await fetch('/admin/users', {
            method: 'GET',
            headers: authHeaders()
        });

        if (response.status === 403) {
            rowsEl.innerHTML = '<div class="admin-empty">Access denied</div>';
            return;
        }

        const result = await response.json();
        adminUsers = result.users || [];
        renderAdminStats();
        renderAdminUserList();
    } catch (err) {
        console.error('Failed to fetch users:', err);
        rowsEl.innerHTML = '<div class="admin-empty">Failed to load users</div>';
    }
}

function renderAdminStats() {
    const total = adminUsers.length;
    const active = adminUsers.filter(u => u.status === 'ACTIVE').length;
    const blocked = adminUsers.filter(u => u.status === 'BLOCKED').length;

    const el = id => document.getElementById(id);
    if (el('statTotal')) el('statTotal').textContent = total;
    if (el('statActive')) el('statActive').textContent = active;
    if (el('statBlocked')) el('statBlocked').textContent = blocked;
    if (el('userCount')) el('userCount').textContent = total;
}

function renderAdminUserList() {
    const rowsEl = document.getElementById('adminUserRows');
    const currentUser = getUser();
    if (!rowsEl) return;

    if (adminUsers.length === 0) {
        rowsEl.innerHTML = '<div class="admin-empty">No users found</div>';
        return;
    }

    rowsEl.innerHTML = adminUsers.map(user => {
        const isSelf = user._id === currentUser.id;
        const typeBadge = user.type === 'ADMIN'
            ? '<span class="badge-admin">ADMIN</span>'
            : '<span class="badge-user">USER</span>';
        const statusBadge = user.status === 'BLOCKED'
            ? '<span class="badge-blocked">BLOCKED</span>'
            : '<span class="badge-active">ACTIVE</span>';

        let actions = '';

        if (!isSelf) {
            if (user.type === 'USER') {
                actions += `<button class="action-btn btn-make-admin" onclick="adminMakeAdmin('${user._id}')">Make Admin</button>`;
            } else {
                actions += `<button class="action-btn btn-remove-admin" onclick="adminRemoveAdmin('${user._id}')">Remove Admin</button>`;
            }

            if (user.status === 'BLOCKED') {
                actions += `<button class="action-btn btn-unblock" onclick="adminUnblockUser('${user._id}')">Unblock</button>`;
            } else {
                actions += `<button class="action-btn btn-block" onclick="adminBlockUser('${user._id}')">Block</button>`;
            }

            actions += `<button class="action-btn btn-delete" onclick="adminDeleteUser('${user._id}')">Delete</button>`;
        } else {
            actions = '<span style="font-size:10px;color:rgba(255,255,255,0.3)">You</span>';
        }

        return `
            <div class="admin-user-row">
                <div class="col-name">${escapeHtml(user.name)}</div>
                <div class="col-email">${escapeHtml(user.email)}</div>
                <div class="col-type">${typeBadge}</div>
                <div class="col-status">${statusBadge}</div>
                <div class="col-actions">${actions}</div>
            </div>
        `;
    }).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function adminMakeAdmin(userId) {
    const confirmed = await openCustomConfirm('Confirm', 'Make this user an admin?');
    if (!confirmed) return;

    try {
        const response = await fetch(`/admin/promote-to-admin/${userId}`, {
            method: 'POST',
            headers: authHeaders()
        });
        const result = await response.json();
        if (response.ok) {
            openCustomAlert('Success', 'User promoted to admin.', 'info');
            refreshAdminUsers();
        } else {
            openCustomAlert('Error', result.message || 'Failed to promote user.', 'error');
        }
    } catch (err) {
        console.error(err);
        openCustomAlert('Error', 'Failed to promote user.', 'error');
    }
}

async function adminRemoveAdmin(userId) {
    const confirmed = await openCustomConfirm('Confirm', 'Remove admin access from this user?');
    if (!confirmed) return;

    try {
        const response = await fetch(`/admin/remove-admin/${userId}`, {
            method: 'POST',
            headers: authHeaders()
        });
        const result = await response.json();
        if (response.ok) {
            openCustomAlert('Success', 'Admin access removed.', 'info');
            refreshAdminUsers();
        } else {
            openCustomAlert('Error', result.message || 'Failed to remove admin.', 'error');
        }
    } catch (err) {
        console.error(err);
        openCustomAlert('Error', 'Failed to remove admin.', 'error');
    }
}

async function adminBlockUser(userId) {
    const confirmed = await openCustomConfirm('Confirm', 'Block this user? They will not be able to log in.');
    if (!confirmed) return;

    try {
        const response = await fetch('/admin/block-user', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ userId })
        });
        const result = await response.json();
        if (response.ok) {
            openCustomAlert('Success', 'User blocked.', 'info');
            refreshAdminUsers();
        } else {
            openCustomAlert('Error', result.message || 'Failed to block user.', 'error');
        }
    } catch (err) {
        console.error(err);
        openCustomAlert('Error', 'Failed to block user.', 'error');
    }
}

async function adminUnblockUser(userId) {
    try {
        const response = await fetch('/admin/unblock-user', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ userId })
        });
        const result = await response.json();
        if (response.ok) {
            openCustomAlert('Success', 'User unblocked.', 'info');
            refreshAdminUsers();
        } else {
            openCustomAlert('Error', result.message || 'Failed to unblock user.', 'error');
        }
    } catch (err) {
        console.error(err);
        openCustomAlert('Error', 'Failed to unblock user.', 'error');
    }
}

async function adminDeleteUser(userId) {
    const confirmed = await openCustomConfirm('Confirm', 'Delete this user? They will not be able to log in.');
    if (!confirmed) return;

    try {
        const response = await fetch(`/admin/user/${userId}`, {
            method: 'DELETE',
            headers: authHeaders()
        });
        const result = await response.json();
        if (response.ok) {
            openCustomAlert('Success', 'User deleted.', 'info');
            refreshAdminUsers();
        } else {
            openCustomAlert('Error', result.message || 'Failed to delete user.', 'error');
        }
    } catch (err) {
        console.error(err);
        openCustomAlert('Error', 'Failed to delete user.', 'error');
    }
}

document.addEventListener('DOMContentLoaded', function () {
    const adminBtn = document.getElementById('adminbtn');
    if (adminBtn) {
        adminBtn.addEventListener('click', openAdminPanel);
    }
});

/* ─────────────────────────────────────────────
   WiFi Settings (All Users)
───────────────────────────────────────────────*/
let wifiPasswordVisible = false;
let savedWifiList = [];

function toggleWifiPasswordVisibility() {
    const input = document.getElementById('wifiPassword');
    const icon = document.getElementById('wifiEyeIcon');
    if (!input || !icon) return;

    wifiPasswordVisible = !wifiPasswordVisible;
    input.type = wifiPasswordVisible ? 'text' : 'password';
    icon.innerHTML = wifiPasswordVisible
        ? '<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
        : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function renderWifiSavedList() {
    const listEl = document.getElementById('wifiSavedList');
    if (!listEl) return;

    if (savedWifiList.length === 0) {
        listEl.innerHTML = '<div class="wifi-saved-empty">No saved networks yet</div>';
        return;
    }

    listEl.innerHTML = savedWifiList.map((item, idx) => `
        <div class="wifi-saved-item" onclick="selectWifiEntry(${idx})">
            <div class="wifi-saved-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.55a11 11 0 0114.08 0M1.42 9a16 16 0 0121.16 0M8.53 16.11a6 6 0 016.95 0M12 20h.01"/></svg>
            </div>
            <div class="wifi-saved-info">
                <div class="wifi-saved-name">${escapeHtml(item.wifiName)}</div>
                <div class="wifi-saved-date">Saved ${formatDate(item.updatedAt || item.createdAt)}</div>
            </div>
        </div>
    `).join('');
}

function selectWifiEntry(idx) {
    const item = savedWifiList[idx];
    if (!item) return;

    document.getElementById('wifiSsid').value = item.wifiName || '';
    document.getElementById('wifiPassword').value = item.wifiPassword || '';
    wifiPasswordVisible = false;
    const pwInput = document.getElementById('wifiPassword');
    const icon = document.getElementById('wifiEyeIcon');
    if (pwInput) pwInput.type = 'password';
    if (icon) {
        icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
    }

    // Update selection highlight
    document.querySelectorAll('.wifi-saved-item').forEach((el, i) => {
        el.classList.toggle('selected', i === idx);
    });
}

async function openWifiSettingsPopup() {
    const popup = document.getElementById('wifiSettingsPopup');
    if (!popup) return;

    // Reset fields
    document.getElementById('wifiSsid').value = '';
    document.getElementById('wifiPassword').value = '';
    wifiPasswordVisible = false;
    const pwInput = document.getElementById('wifiPassword');
    const icon = document.getElementById('wifiEyeIcon');
    if (pwInput) pwInput.type = 'password';
    if (icon) {
        icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
    }

    // Clear selection
    document.querySelectorAll('.wifi-saved-item').forEach(el => el.classList.remove('selected'));

    // Load saved networks
    const listEl = document.getElementById('wifiSavedList');
    if (listEl) listEl.innerHTML = '<div class="wifi-saved-loading">Loading saved networks...</div>';

    try {
        const response = await fetch('/user/wifi-data', {
            method: 'GET',
            headers: authHeaders()
        });
        const result = await response.json();
        savedWifiList = result.wifiData || [];
        renderWifiSavedList();
    } catch (err) {
        console.error('Failed to fetch WiFi data:', err);
        if (listEl) listEl.innerHTML = '<div class="wifi-saved-empty">Failed to load networks</div>';
    }

    popup.classList.add('open');
}

function closeWifiSettingsPopup() {
    document.getElementById('wifiSettingsPopup')?.classList.remove('open');
}

async function saveWifiSettings() {
    const ssid = document.getElementById('wifiSsid')?.value.trim();
    const password = document.getElementById('wifiPassword')?.value.trim();

    if (!ssid || !password) {
        openCustomAlert('Error', 'Please enter both SSID and password.', 'error');
        return;
    }

    try {
        const response = await fetch('/user/wifi-data', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ wifiName: ssid, wifiPassword: password })
        });
        const result = await response.json();

        if (response.ok) {
            openCustomAlert('Success', 'WiFi settings saved successfully.', 'info');
            closeWifiSettingsPopup();
        } else {
            openCustomAlert('Error', result.message || 'Failed to save WiFi settings.', 'error');
        }
    } catch (err) {
        console.error(err);
        openCustomAlert('Error', 'Failed to save WiFi settings.', 'error');
    }
}

document.addEventListener('DOMContentLoaded', function () {
    const wifiSettingsBtn = document.getElementById('wifiSettingsBtn');
    if (wifiSettingsBtn) {
        wifiSettingsBtn.addEventListener('click', openWifiSettingsPopup);
    }

    const saveWifiBtn = document.getElementById('saveWifiSettings');
    if (saveWifiBtn) {
        saveWifiBtn.addEventListener('click', saveWifiSettings);
    }
});

/* ─────────────────────────────────────────────
   TIMER SYSTEM
───────────────────────────────────────────────*/
let activeTimers = {};       // timerId -> { buttonName, action, remainingMs, intervalId }
let timerCardNum = null;     // currently open popup card number
let timerDuration = 0;
let timerAction = null;
let timerIntervalId = null;  // interval for live countdown in popup

// Button name to card number mapping
const BTN_TO_CARD = { btn1: 1, btn2: 2, btn3: 3, btn4: 4 };
const CARD_TO_BTN = { 1: 'btn1', 2: 'btn2', 3: 'btn3', 4: 'btn4' };

async function fetchAndSyncTimers() {
    try {
        const response = await fetch('/timer/active', {
            method: 'GET',
            headers: authHeaders()
        });
        if (!response.ok) return;

        const result = await response.json();
        const serverTimers = result.timers || [];

        // Clear existing intervals
        Object.values(activeTimers).forEach(t => clearInterval(t.intervalId));

        // Build new map
        const newTimers = {};
        serverTimers.forEach(t => {
            const cardNum = BTN_TO_CARD[t.buttonName];
            if (cardNum) {
                startTimerCountdown(t.id, t.buttonName, t.action, t.remainingMs);
                newTimers[t.id] = activeTimers[t.id];
            }
        });

        activeTimers = newTimers;
        updateAllTimerDisplays();
        updateStatusBarTimer();
    } catch (err) {
        console.error('Failed to sync timers:', err);
    }
}

function startTimerCountdown(timerId, buttonName, action, remainingMs) {
    const cardNum = BTN_TO_CARD[buttonName];  // e.g. 'btn1' -> 1
    if (!cardNum) return;

    // Clear any existing interval for this timer
    if (activeTimers[timerId]?.intervalId) {
        clearInterval(activeTimers[timerId].intervalId);
    }

    function tick() {
        remainingMs -= 1000;
        if (remainingMs <= 0) {
            clearInterval(activeTimers[timerId]?.intervalId);
            delete activeTimers[timerId];
            onTimerComplete(buttonName, action, cardNum);
        } else {
            activeTimers[timerId].remainingMs = remainingMs;
            renderTimerCountdown(cardNum, remainingMs, action);
        }
        updateStatusBarTimer();
    }

    const intervalId = setInterval(tick, 1000);
    activeTimers[timerId] = { buttonName, action, remainingMs, intervalId };
    renderTimerCountdown(cardNum, remainingMs, action);

    // Update timer button
    const btn = document.getElementById('timerBtn' + cardNum);
    if (btn) btn.classList.add('active');
}

function renderTimerCountdown(cardNum, remainingMs, action) {
    const el = document.getElementById('timerCountdown' + cardNum);
    if (!el) return;

    const totalSec = Math.ceil(remainingMs / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;

    let timeStr;
    if (h > 0) {
        timeStr = `${h}h ${m}m`;
    } else if (m > 0) {
        timeStr = `${m}m ${s}s`;
    } else {
        timeStr = `${s}s`;
    }

    el.textContent = `${action === 'ON' ? '⏻ ON' : '○ OFF'} in ${timeStr}`;
    el.classList.add('active');
}

function clearTimerCountdown(cardNum) {
    const el = document.getElementById('timerCountdown' + cardNum);
    if (el) {
        el.textContent = '';
        el.classList.remove('active');
    }
    const btn = document.getElementById('timerBtn' + cardNum);
    if (btn) btn.classList.remove('active');
}

function onTimerComplete(buttonName, action, cardNum) {
    clearTimerCountdown(cardNum);
    // Toggle the device immediately
    handleCardToggle(cardNum);
    openCustomAlert('Timer Complete', `${buttonName} turned ${action}.`, 'info');
}

function updateAllTimerDisplays() {
    // Clear all countdown displays first
    for (let i = 1; i <= 4; i++) {
        clearTimerCountdown(i);
    }
    // Re-render active ones
    Object.values(activeTimers).forEach(t => {
        const cardNum = BTN_TO_CARD[t.buttonName];
        if (cardNum) {
            renderTimerCountdown(cardNum, t.remainingMs, t.action);
        }
    });
}

function updateStatusBarTimer() {
    const count = Object.keys(activeTimers).length;
    const bar = document.getElementById('statusBarTimer');
    if (!bar) return;

    if (count === 0) {
        bar.style.display = 'none';
    } else {
        bar.style.display = '';
        const first = Object.values(activeTimers)[0];
        const totalSec = Math.ceil(first.remainingMs / 1000);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        bar.querySelector('.timer-status-text').textContent =
            `${count} timer${count > 1 ? 's' : ''} · ${first.buttonName} ${first.action} in ${m}:${String(s).padStart(2, '0')}`;
    }
}

function openTimerPopup(buttonName, cardNum) {
    timerCardNum = cardNum;
    timerDuration = 0;
    timerAction = null;

    // Update popup title with device name
    const card = document.getElementById('card' + cardNum);
    const deviceName = card?.querySelector('.card-name')?.textContent || buttonName;
    const deviceRoom = card?.querySelector('.card-room')?.textContent || '';
    document.getElementById('timerTargetName').textContent = deviceName;
    document.getElementById('timerTargetRoom').textContent = deviceRoom;

    // Reset UI
    document.querySelectorAll('.timer-preset').forEach(b => b.classList.remove('selected'));
    document.getElementById('timerCustomMinutes').value = '';
    document.getElementById('timerActionOn').classList.remove('selected-on');
    document.getElementById('timerActionOff').classList.remove('selected-off');
    document.getElementById('timerSummary').classList.remove('active');
    document.getElementById('timerSummaryText').textContent = 'Select a duration and action';

    // Check if this card has an active timer
    const activeTimer = Object.values(activeTimers).find(t => CARD_TO_BTN[cardNum] === t.buttonName);

    if (activeTimer) {
        // Show cancel UI
        document.getElementById('timerActiveInfo').style.display = '';
        document.getElementById('startTimerBtn').style.display = 'none';
        document.getElementById('cancelTimerBtn').style.display = '';
        document.getElementById('timerPresets').style.display = 'none';
        document.getElementById('timerCustomRow').style.display = 'none';
        document.getElementById('timerSummary').style.display = 'none';

        // Start live countdown in popup
        if (timerIntervalId) clearInterval(timerIntervalId);
        updatePopupCountdown(activeTimer);

        timerIntervalId = setInterval(() => {
            const t = Object.values(activeTimers).find(t => CARD_TO_BTN[cardNum] === t.buttonName);
            if (t) {
                updatePopupCountdown(t);
            } else {
                clearInterval(timerIntervalId);
                closeTimerPopup();
            }
        }, 1000);
    } else {
        // Show set timer UI
        document.getElementById('timerActiveInfo').style.display = 'none';
        document.getElementById('startTimerBtn').style.display = '';
        document.getElementById('cancelTimerBtn').style.display = 'none';
        document.getElementById('timerPresets').style.display = '';
        document.getElementById('timerCustomRow').style.display = '';
        document.getElementById('timerSummary').style.display = '';
    }

    document.getElementById('timerPopup').classList.add('open');
}

function updatePopupCountdown(timer) {
    const totalSec = Math.ceil(timer.remainingMs / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;

    let timeStr;
    if (h > 0) {
        timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    } else {
        timeStr = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    document.getElementById('timerActiveCountdown').textContent = timeStr;
    document.getElementById('timerActiveSub').textContent =
        `${CARD_TO_BTN[timerCardNum]} will turn ${timer.action}`;
}

function closeTimerPopup() {
    document.getElementById('timerPopup')?.classList.remove('open');
    if (timerIntervalId) {
        clearInterval(timerIntervalId);
        timerIntervalId = null;
    }
    timerCardNum = null;
    timerDuration = 0;
    timerAction = null;
}

function setTimerDuration(minutes) {
    timerDuration = minutes;
    document.getElementById('timerCustomMinutes').value = '';
    document.querySelectorAll('.timer-preset').forEach(b => {
        b.classList.toggle('selected', parseInt(b.dataset.minutes) === minutes);
    });
    updateTimerSummary();
}

function setTimerAction(action) {
    timerAction = action;
    document.getElementById('timerActionOn').classList.toggle('selected-on', action === 'ON');
    document.getElementById('timerActionOff').classList.toggle('selected-off', action === 'OFF');
    updateTimerSummary();
}

function updateTimerSummary() {
    const summaryEl = document.getElementById('timerSummary');
    const textEl = document.getElementById('timerSummaryText');

    if (!timerDuration || !timerAction) {
        summaryEl.classList.remove('active');
        textEl.textContent = 'Select a duration and action';
        return;
    }

    const m = timerDuration;
    const actionText = timerAction === 'ON' ? 'turn ON' : 'turn OFF';
    summaryEl.classList.add('active');
    textEl.textContent = `Will ${actionText} after ${m} minute${m > 1 ? 's' : ''}`;
}

// Listen to custom minutes input
document.addEventListener('DOMContentLoaded', function () {
    const customInput = document.getElementById('timerCustomMinutes');
    if (customInput) {
        customInput.addEventListener('input', function () {
            const val = parseInt(this.value);
            if (val > 0) {
                timerDuration = val;
                document.querySelectorAll('.timer-preset').forEach(b => b.classList.remove('selected'));
                updateTimerSummary();
            }
        });
    }
});

async function startTimer() {
    if (!timerDuration || !timerAction || !timerCardNum) {
        openCustomAlert('Error', 'Please select a duration and action.', 'error');
        return;
    }

    const card = document.getElementById('card' + timerCardNum);
    const buttonId = card?.dataset?.buttonId;
    const buttonName = 'btn' + timerCardNum;

    if (!buttonId) {
        openCustomAlert('Error', 'Device not found. Please refresh the page.', 'error');
        return;
    }

    try {
        const response = await fetch('/timer/create', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
                buttonId,
                buttonName,
                action: timerAction,
                durationMinutes: timerDuration,
            })
        });

        const result = await response.json();

        if (response.ok) {
            const t = result.timer;
            closeTimerPopup();
            openCustomAlert('Timer Set', `${buttonName} will turn ${t.action} in ${t.durationMinutes} min.`, 'info');
            startTimerCountdown(t.id, buttonName, t.action, t.remainingMs);
            updateStatusBarTimer();
        } else {
            openCustomAlert('Error', result.message || 'Failed to set timer.', 'error');
        }
    } catch (err) {
        console.error(err);
        openCustomAlert('Error', 'Failed to set timer.', 'error');
    }
}

async function cancelCurrentTimer() {
    if (!timerCardNum) return;

    const btnName = 'btn' + timerCardNum;
    // activeTimers[timerId] -> { buttonName, action, remainingMs, intervalId }
    // timerId is the KEY of the map, not entry.id
    const found = Object.entries(activeTimers).find(([id, t]) => t.buttonName === btnName);
    if (!found) {
        closeTimerPopup();
        return;
    }

    const [timerId, timerEntry] = found;

    try {
        const response = await fetch(`/timer/cancel/${timerId}`, {
            method: 'DELETE',
            headers: authHeaders()
        });

        if (response.ok) {
            if (timerEntry.intervalId) clearInterval(timerEntry.intervalId);
            delete activeTimers[timerId];

            clearTimerCountdown(timerCardNum);
            closeTimerPopup();
            openCustomAlert('Cancelled', 'Timer has been cancelled.', 'info');
            updateStatusBarTimer();
        } else {
            const result = await response.json();
            openCustomAlert('Error', result.message || 'Failed to cancel timer.', 'error');
        }
    } catch (err) {
        console.error(err);
        openCustomAlert('Error', 'Failed to cancel timer.', 'error');
    }
}

// Sync timers on page load
window.addEventListener('DOMContentLoaded', fetchAndSyncTimers);

// Refresh timers periodically (every 30s as backup)
setInterval(fetchAndSyncTimers, 30000);
