const mqtt = require('mqtt');
const User = require('../models/userdataschem');
const ButtonState = require('../models/LAST5BUTTON');
const DeviceConnection = require('../models/DeviceConnection');

const MQTT_TOPIC = 'home/+';
const BUTTON_NAMES = ['btn1', 'btn2', 'btn3', 'btn4'];

const client = mqtt.connect(process.env.MQTT_URL || 'mqtt://localhost:1883', {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  clientId: `home-server-${process.pid}`,
  reconnectPeriod: 5000,
});

const topicForUser = (userId) => `home/${String(userId)}`;

function mqttLog(event, details = {}) {
  const lines = [`┌─ MQTT | ${event}`, `│ Time: ${new Date().toISOString()}`];

  Object.entries(details).forEach(([key, value]) => {
    if (value !== null && typeof value === 'object') {
      lines.push(`│ ${key}:`);
      JSON.stringify(value, null, 2).split('\n').forEach((line) => lines.push(`│   ${line}`));
      return;
    }
    lines.push(`│ ${key}: ${String(value)}`);
  });

  lines.push('└─');
  console.log(`\n${lines.join('\n')}`);
}

function publishToUser(userId, message) {
  const topic = topicForUser(userId);
  if (!client.connected) {
    mqttLog('PUBLISH SKIPPED — broker disconnected', { topic, message });
    return false;
  }

  client.publish(topic, JSON.stringify(message), { qos: 1 }, (error) => {
    if (error) {
      mqttLog('PUBLISH FAILED', { topic, error: error.message, message });
      return;
    }
    mqttLog('PUBLISHED', { topic, message });
  });
  return true;
}

async function updateUserDeviceStatus(userId) {
  const hasOnlineDevice = await DeviceConnection.exists({ userId, status: 'ONLINE' });
  await User.findByIdAndUpdate(userId, { deviceStatus: hasOnlineDevice ? 'ONLINE' : 'OFFLINE' });
  return hasOnlineDevice ? 'ONLINE' : 'OFFLINE';
}

async function syncButtonsToDevice(userId, deviceId) {
  const buttons = await ButtonState.find({ userId, type: 'USER' });
  mqttLog('SYNCING BUTTON STATES', { deviceId, count: buttons.length });

  buttons.forEach((button) => {
    publishToUser(userId, {
      type: 'button_update',
      button: button.buttonName,
      status: Number(button.state),
      targetDeviceId: deviceId,
    });
  });
}

async function handleDeviceStatus(userId, data) {
  const status = data.status === 'OFFLINE' ? 'OFFLINE' : 'ONLINE';
  const update = { userId, status };
  if (status === 'ONLINE') update.lastHeartbeat = Date.now();

  await DeviceConnection.findOneAndUpdate(
    { deviceId: data.deviceId },
    update,
    { upsert: true }
  );

  const userStatus = await updateUserDeviceStatus(userId);
  mqttLog('DEVICE STATUS UPDATED', { deviceId: data.deviceId, status, userStatus });

  // A register is the only event that needs an initial relay-state sync.
  if (data.type === 'register' && status === 'ONLINE') {
    await syncButtonsToDevice(userId, data.deviceId);
  }
}

async function handleButtonState(userId, data) {
  let updatedCount = 0;
  for (const buttonName of BUTTON_NAMES) {
    if (!Object.prototype.hasOwnProperty.call(data, buttonName)) continue;

    await ButtonState.findOneAndUpdate(
      { userId, buttonName, type: 'USER' },
      { state: String(data[buttonName]), timestamp: Date.now() },
      { upsert: true }
    );
    updatedCount += 1;
  }
  mqttLog('BUTTON STATES SAVED', { deviceId: data.deviceId, count: updatedCount });
}

async function handleMessage(topic, raw, packet) {
  const match = /^home\/([^/]+)$/.exec(topic);
  if (!match) {
    mqttLog('IGNORED MESSAGE — unsupported topic', { topic });
    return;
  }

  let data;
  try {
    data = JSON.parse(raw.toString());
  } catch {
    mqttLog('IGNORED INVALID JSON', {
      topic,
      retained: Boolean(packet?.retain),
      payload: raw.toString(),
    });
    return;
  }

  // On server restart, MQTT replays retained messages. Only the retained
  // ONLINE/OFFLINE state is useful; register and command history stays ignored.
  const retained = Boolean(packet?.retain);
  const retainedStatus = retained && data.type === 'status';
  if (retained && !retainedStatus) {
    mqttLog('RETAINED MESSAGE IGNORED', {
      topic,
      qos: packet?.qos ?? 0,
      type: data.type || 'unknown',
      deviceId: data.deviceId || 'missing',
      payload: data,
    });
    return;
  }

  mqttLog(retainedStatus ? 'RETAINED STATUS RESTORED' : 'FRESH MESSAGE RECEIVED', {
    topic,
    retained,
    qos: packet?.qos ?? 0,
    type: data.type || 'unknown',
    deviceId: data.deviceId || 'missing',
    payload: data,
  });

  const userId = match[1];
  if (!data.deviceId) {
    mqttLog('IGNORED MESSAGE — deviceId missing', { topic });
    return;
  }
  if (!(await User.exists({ _id: userId }))) {
    mqttLog('IGNORED MESSAGE — unknown user', { topic, userId, deviceId: data.deviceId });
    return;
  }

  if (data.type === 'register' || data.type === 'status') {
    await handleDeviceStatus(userId, data);
    return;
  }

  if (data.type === 'heartbeat') {
    await DeviceConnection.findOneAndUpdate(
      { deviceId: data.deviceId },
      { lastHeartbeat: Date.now(), status: 'ONLINE' }
    );
    const userStatus = await updateUserDeviceStatus(userId);
    mqttLog('HEARTBEAT SAVED', { deviceId: data.deviceId, userStatus });
    return;
  }

  if (data.type === 'button_state') {
    await handleButtonState(userId, data);
    return;
  }

  mqttLog('IGNORED MESSAGE — unsupported type', { type: data.type || 'missing', deviceId: data.deviceId });
}

client.on('connect', () => {
  mqttLog('BROKER CONNECTED', { subscription: MQTT_TOPIC });
  client.subscribe(MQTT_TOPIC, { qos: 1 }, (error) => {
    if (error) {
      mqttLog('SUBSCRIPTION FAILED', { topic: MQTT_TOPIC, error: error.message });
      return;
    }
    mqttLog('SUBSCRIBED', { topic: MQTT_TOPIC, qos: 1 });
  });
});

client.on('reconnect', () => mqttLog('RECONNECTING TO BROKER'));
client.on('offline', () => mqttLog('BROKER CONNECTION OFFLINE'));
client.on('close', () => mqttLog('BROKER CONNECTION CLOSED'));
client.on('message', (topic, message, packet) => {
  handleMessage(topic, message, packet).catch((error) => {
    mqttLog('MESSAGE HANDLER FAILED', { topic, error: error.message });
  });
});
client.on('error', (error) => mqttLog('CONNECTION ERROR', { error: error.message }));

module.exports = { client, topicForUser, publishToUser };
