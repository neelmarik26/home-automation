const WebSocket = require('ws');
const ButtonState = require('../models/LAST5BUTTON');

const userSockets = new Map();
let espSocket = null;
let espConnected = false;
let espDeviceId = 'esp32';

function getUserKey(userId) {
  return String(userId);
}

function addSocket(userId, ws) {
  const userKey = getUserKey(userId);

  if (!userSockets.has(userKey)) {
    userSockets.set(userKey, new Set());
  }

  const sockets = userSockets.get(userKey);
  sockets.add(ws);
  ws.userId = userKey;
  sendSystemStatusToUser(userId);
}

function removeSocket(ws) {
  const userKey = ws.userId;
  if (!userKey || !userSockets.has(userKey)) {
    return;
  }

  const sockets = userSockets.get(userKey);
  sockets.delete(ws);

  if (sockets.size === 0) {
    userSockets.delete(userKey);
  }
}

function sendJson(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function sendToUser(userId, payload) {
  const userKey = getUserKey(userId);
  const sockets = userSockets.get(userKey);

  if (!sockets) {
    return;
  }

  for (const ws of sockets) {
    sendJson(ws, payload);
  }
}

function buildSystemStatusPayload(userId) {
  return {
    type: 'system-status',
    userId: userId ? String(userId) : null,
    userSocketConnected: !!(userId && userSockets.has(getUserKey(userId))),
    espSocketConnected: espConnected,
    espDeviceId,
  };
}

function sendSystemStatusToUser(userId) {
  sendToUser(userId, buildSystemStatusPayload(userId));
}

function sendSystemStatusToAllUsers() {
  for (const userId of userSockets.keys()) {
    sendSystemStatusToUser(userId);
  }
}

async function sendAllButtonsToUser(userId) {
  const buttons = await ButtonState.find({
    userId,
    type: 'USER',
  }).sort({ buttonName: 1 });

  sendToUser(userId, {
    type: 'button-status',
    userId: String(userId),
    buttons,
  });

  return buttons;
}

function sendButtonUpdateToUser(userId, button) {
  sendToUser(userId, {
    type: 'button-update',
    userId: String(userId),
    button,
  });
}

function setEspSocket(ws, deviceId = 'esp32') {
  espSocket = ws;
  espConnected = true;
  espDeviceId = deviceId || 'esp32';
  ws.isEspSocket = true;
  ws.deviceId = espDeviceId;
  sendSystemStatusToAllUsers();
}

function clearEspSocket(ws) {
  if (espSocket !== ws) {
    return;
  }

  espSocket = null;
  espConnected = false;
  espDeviceId = 'esp32';
  sendSystemStatusToAllUsers();
}

module.exports = {
  addSocket,
  buildSystemStatusPayload,
  clearEspSocket,
  setEspSocket,
  removeSocket,
  sendAllButtonsToUser,
  sendButtonUpdateToUser,
  sendSystemStatusToAllUsers,
  sendSystemStatusToUser,
  sendToUser,
};
