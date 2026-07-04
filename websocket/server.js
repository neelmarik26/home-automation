const WebSocket = require('ws');
const {
    registerDevice,
    removeDevice,
    updateHeartbeat,
    notifyEspStatusChange
} = require('./connectionManager');
const User = require('../models/userdataschem');
const ButtonState = require('../models/LAST5BUTTON');
const DeviceConnection = require('../models/DeviceConnection');

function setupWebSocketServer(httpServer) {
    const wss = new WebSocket.Server({ noServer: true });

    const HEARTBEAT_INTERVAL = 300000;  // 5 minutes

    // Heartbeat check interval
    const heartbeatInterval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                if (ws.deviceId) {
                    handleDeviceDisconnect(ws.deviceId);
                    removeDevice(ws.deviceId);
                }
                return ws.terminate();
            }
            ws.isAlive = false;
            ws.ping();
        });
    }, HEARTBEAT_INTERVAL);

    // Manual upgrade handling to strip extensions and prevent RSV1 errors
    httpServer.on('upgrade', (request, socket, head) => {
        const url = new URL(request.url, `http://${request.headers.host}`);

        if (url.pathname === '/ws') {
            // Strip the sec-websocket-extensions header
            delete request.headers['sec-websocket-extensions'];

            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit('connection', ws, request);
            });
        }
    });

    async function handleDeviceDisconnect(deviceId) {
        try {
            await DeviceConnection.findOneAndUpdate(
                { deviceId },
                { status: 'OFFLINE', lastHeartbeat: Date.now() }
            );
            const deviceConn = await DeviceConnection.findOne({ deviceId });
            if (deviceConn) {
                await User.findByIdAndUpdate(deviceConn.userId, { deviceStatus: 'OFFLINE' });
                notifyEspStatusChange(deviceConn.userId.toString(), deviceId, 'OFFLINE');
            }
        } catch (err) {
            console.error('Error handling device disconnect:', err);
        }
    }

    wss.on('connection', async (ws, req) => {
        console.log('WebSocket connection received on /ws!');
        console.log('URL:', req.url);
        console.log('Headers:', req.headers);
        ws.isAlive = true;

        ws.on('pong', () => {
            ws.isAlive = true;
        });

        ws.on('message', async (message) => {
            let data;
            try {
                const msgStr = message.toString();
                try {
                    data = JSON.parse(msgStr);
                } catch {
                    data = { raw: msgStr };
                }
            } catch (e) {
                console.error('Error parsing message:', e);
                return;
            }

            // Handle registration
            if (data.type === 'register' && data.deviceId && data.userId) {
                try {
                    // Validate user owns this device
                    const user = await User.findById(data.userId);
                    if (!user) {
                        ws.send(JSON.stringify({ type: 'error', message: 'User not found' }));
                        return;
                    }

                    // Store device connection
                    ws.deviceId = data.deviceId;
                    ws.userId = data.userId;
                    registerDevice(data.deviceId, data.userId, ws);

                    // Update DB status
                    await DeviceConnection.findOneAndUpdate(
                        { deviceId: data.deviceId },
                        { status: 'ONLINE', lastHeartbeat: Date.now(), userId: data.userId },
                        { upsert: true }
                    );
                    await User.findByIdAndUpdate(data.userId, { deviceStatus: 'ONLINE', deviceId: data.deviceId });

                    // Send current button states
                    const buttons = await ButtonState.find({ userId: data.userId, type: 'USER' });
                    const buttonStates = {};
                    buttons.forEach(b => { buttonStates[b.buttonName] = parseInt(b.state); });

                    ws.send(JSON.stringify({
                        type: 'register_ack',
                        status: 'ok',
                        buttons: buttonStates
                    }));

                    // Notify frontend
                    notifyEspStatusChange(data.userId, data.deviceId, 'ONLINE');
                    console.log(`ESP32 registered: deviceId=${data.deviceId}, userId=${data.userId}`);
                } catch (err) {
                    console.error('Registration error:', err);
                    ws.send(JSON.stringify({ type: 'error', message: 'Registration failed' }));
                }
                return;
            }

            // Handle ping
            if (data.type === 'ping' || data.raw === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
                if (ws.deviceId) updateHeartbeat(ws.deviceId);
                return;
            }

            // Handle button state update from ESP
            if (data.type === 'button_state' && ws.userId) {
                try {
                    for (const [btn, status] of Object.entries(data)) {
                        if (['btn1', 'btn2', 'btn3', 'btn4'].includes(btn)) {
                            await ButtonState.findOneAndUpdate(
                                { userId: ws.userId, buttonName: btn, type: 'USER' },
                                { state: String(status), timestamp: Date.now() }
                            );
                        }
                    }
                } catch (err) {
                    console.error('Error updating button state from ESP:', err);
                }
                return;
            }
        });

        ws.on('close', () => {
            if (ws.deviceId) {
                handleDeviceDisconnect(ws.deviceId);
                removeDevice(ws.deviceId);
            }
        });

        ws.on('error', (err) => {
            console.error('WebSocket error:', err.message);
        });
    });

    wss.on('close', () => clearInterval(heartbeatInterval));

    console.log('WebSocket server initialized on /ws');
    return wss;
}

module.exports = { setupWebSocketServer };
