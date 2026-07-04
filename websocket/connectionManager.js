// In-memory connection registries
const deviceConnections = new Map();  // deviceId -> { ws, userId, lastHeartbeat }
const userConnections = new Map();     // userId -> { ws }
const userEspStatusListeners = new Map();  // userId -> Set of WebSocket clients

function registerDevice(deviceId, userId, ws) {
    deviceConnections.set(deviceId, { ws, userId, lastHeartbeat: Date.now() });
}

function registerUser(userId, ws) {
    userConnections.set(userId, { ws, lastHeartbeat: Date.now() });
}

function registerEspStatusListener(userId, ws) {
    if (!userEspStatusListeners.has(userId)) {
        userEspStatusListeners.set(userId, new Set());
    }
    userEspStatusListeners.get(userId).add(ws);
}

function getEspWebSocket(userId) {
    const userIdStr = userId.toString();
    for (const [, conn] of deviceConnections) {
        if (conn.userId === userIdStr) return conn.ws;
    }
    return null;
}

function getUserWebSocket(userId) {
    const conn = userConnections.get(userId);
    return conn ? conn.ws : null;
}

function removeDevice(deviceId) {
    deviceConnections.delete(deviceId);
}

function removeUser(userId) {
    userConnections.delete(userId);
}

function removeEspStatusListener(userId, ws) {
    const listeners = userEspStatusListeners.get(userId);
    if (listeners) {
        listeners.delete(ws);
        if (listeners.size === 0) {
            userEspStatusListeners.delete(userId);
        }
    }
}

function updateHeartbeat(deviceId) {
    const conn = deviceConnections.get(deviceId);
    if (conn) conn.lastHeartbeat = Date.now();
}

function getDeviceConnection(deviceId) {
    return deviceConnections.get(deviceId);
}

function getDeviceConnections() {
    return deviceConnections;
}

function getUserEspStatusListeners(userId) {
    return userEspStatusListeners.get(userId);
}

function isDeviceOnlineForUser(userId) {
    const userIdStr = userId.toString();
    for (const [, conn] of deviceConnections) {
        if (conn.userId === userIdStr) return true;
    }
    return false;
}

function notifyEspStatusChange(userId, deviceId, status) {
    const listeners = userEspStatusListeners.get(userId);
    if (listeners) {
        const message = JSON.stringify({
            type: 'esp_status',
            deviceId,
            status
        });
        for (const ws of listeners) {
            if (ws.readyState === 1) { // WebSocket.OPEN
                ws.send(message);
            }
        }
    }
}

module.exports = {
    registerDevice,
    registerUser,
    registerEspStatusListener,
    getEspWebSocket,
    getUserWebSocket,
    removeDevice,
    removeUser,
    removeEspStatusListener,
    updateHeartbeat,
    getDeviceConnection,
    getDeviceConnections,
    getUserEspStatusListeners,
    notifyEspStatusChange,
    isDeviceOnlineForUser
};
