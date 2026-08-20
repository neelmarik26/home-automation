const mqtt = require('mqtt');
const User = require('../models/userdataschem');
const ButtonState = require('../models/LAST5BUTTON');
const DeviceConnection = require('../models/DeviceConnection');

const client = mqtt.connect(process.env.MQTT_URL || 'mqtt://localhost:1883', {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  clientId: `home-server-${process.pid}`,
  reconnectPeriod: 5000,
});

const topicForUser = (userId) => `home/${String(userId)}`;

function publishToUser(userId, message) {
  if (!client.connected) return false;
  client.publish(topicForUser(userId), JSON.stringify(message), { qos: 1 });
  return true;
}

async function handleMessage(topic, raw) {
  const match = /^home\/([^/]+)$/.exec(topic);
  if (!match) return;
  const userId = match[1];
  let data;
  try { data = JSON.parse(raw.toString()); } catch { return; }
  console.log("topic",topic)
  console.log("data.deviceId ",data)
  if (!data.deviceId || !(await User.exists({ _id: userId }))) return;

  if (data.type === 'register' || data.type === 'status') {
    const status = data.status === 'OFFLINE' ? 'OFFLINE' : 'ONLINE';
    await DeviceConnection.findOneAndUpdate(
      { deviceId: data.deviceId },
      { userId, status, lastHeartbeat: Date.now() },
      { upsert: true }
    );
    await User.findByIdAndUpdate(userId, {
      deviceStatus: status,
      deviceId: data.deviceId,
    });
    if (status === 'ONLINE') {
      const buttons = await ButtonState.find({ userId, type: 'USER' });
      buttons.forEach((button) => publishToUser(userId, {
        type: 'button_update', button: button.buttonName, status: Number(button.state),
        targetDeviceId: data.deviceId,
      }));
    }
    return;
  }

  if (data.type === 'heartbeat') {
    await DeviceConnection.findOneAndUpdate({ deviceId: data.deviceId }, { lastHeartbeat: Date.now(), status: 'ONLINE' });
    return;
  }

  if (data.type === 'button_state') {
    for (const button of ['btn1', 'btn2', 'btn3', 'btn4']) {
      if (Object.prototype.hasOwnProperty.call(data, button)) {
        await ButtonState.findOneAndUpdate(
          { userId, buttonName: button, type: 'USER' },
          { state: String(data[button]), timestamp: Date.now() },
          { upsert: true }
        );
      }
    }
  }
}

client.on('connect', () => {
  console.log("mqtt connected...")
  client.subscribe('home/+')});
client.on('message', (topic, message) => handleMessage(topic, message).catch((err) => console.error('[MQTT] message error:', err.message)));
client.on('error', (err) => console.error('[MQTT] connection error:', err.message));

setInterval(async () => {
  const cutoff = new Date(Date.now() - 90000);
  const stale = await DeviceConnection.find({ status: 'ONLINE', lastHeartbeat: { $lt: cutoff } }).select('deviceId userId');
  for (const device of stale) {
    await DeviceConnection.updateOne({ deviceId: device.deviceId }, { status: 'OFFLINE' });
    const online = await DeviceConnection.exists({ userId: device.userId, status: 'ONLINE' });
    await User.findByIdAndUpdate(device.userId, { deviceStatus: online ? 'ONLINE' : 'OFFLINE' });
  }
}, 30000);

module.exports = { client, topicForUser, publishToUser };
