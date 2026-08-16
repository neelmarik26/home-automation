require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

const userRoutes = require('./routes/userRoutes');
const adminRoutes = require('./routes/adminRoutes');
const timerRoutes = require('./routes/timerRoutes');
const { setupWebSocketServer } = require('./websocket/server');
const { registerUser, removeUser, registerEspStatusListener, removeEspStatusListener, isDeviceOnlineForUser } = require('./websocket/connectionManager');
const { loadActiveTimers } = require('./controllers/timerController');

const app = express();
const server = http.createServer();

// Mount Express after WebSocket server is set up
// This prevents Express from intercepting WebSocket frames
setupWebSocketServer(server);

// WebSocket endpoint for frontend clients (receives ESP status updates)
// Using noServer mode to handle upgrades manually
const wssFrontend = new WebSocket.Server({ noServer: true });

// Heartbeat for frontend connections
const FRONTEND_HEARTBEAT_INTERVAL = 30000;
setInterval(() => {
    wssFrontend.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            return ws.terminate();
        }
        ws.isAlive = false;
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
        }
    });
}, FRONTEND_HEARTBEAT_INTERVAL);

wssFrontend.on('connection', (ws, req) => {
    ws.isAlive = true;
    
    ws.on('pong', () => {
        ws.isAlive = true;
    });
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            if (data.type === 'pong') {
                ws.isAlive = true;
            }
        } catch (e) {
            // Ignore parse errors
        }
    });
    // Extract token from query string - use url.parse for compatibility
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const token = urlObj.searchParams.get('token');
    if (!token) {
        ws.close(1008, 'Token required');
        return;
    }

    try {
        const decoded = jwt.verify(token, process.env.token);
        const userId = decoded.id;

        ws.userId = userId;
        registerUser(userId, ws);
        registerEspStatusListener(userId, ws);

        // Check if device is online for this user and send initial status
        const isOnline = isDeviceOnlineForUser(userId);
        ws.send(JSON.stringify({
            type: 'connected',
            userId,
            espStatus: isOnline ? 'ONLINE' : 'OFFLINE'
        }));

        ws.on('close', () => {
            removeUser(userId);
            removeEspStatusListener(userId, ws);
        });

        ws.on('error', () => {
            removeUser(userId);
            removeEspStatusListener(userId, ws);
        });
    } catch (err) {
        ws.close(1008, 'Invalid token');
    }
});

// Manual upgrade handling to strip extensions
server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === '/ws-front') {
        // Strip the sec-websocket-extensions header to prevent RSV1 issues
        delete request.headers['sec-websocket-extensions'];

        wssFrontend.handleUpgrade(request, socket, head, (ws) => {
            wssFrontend.emit('connection', ws, request);
        });
    }
    // Note: /ws is handled in websocket/server.js
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Mount Express on the server AFTER WebSocket setup
// This allows WebSocket to handle /ws and /ws-front, while Express handles everything else
server.on('request', app);

app.use('/user', userRoutes);
app.use('/admin', adminRoutes);
app.use('/timer', timerRoutes);

app.get('/', (req, res) => {
    res.render('login.ejs')
});
app.get('/mainpage', (req, res) => {
    res.render('mainpage.ejs')
});
app.get("/supage", (req, res) => {
    res.render('singuppage.ejs')
});

const port = process.env.port || process.env.PORT || 3000;
mongoose
    .connect(process.env.mongodb_url)
    .then(async () => {
        console.log('MongoDB connected successfully');
        await loadActiveTimers();
        server.listen(port, () => {
            console.log(`Server listening on port ${port}`);
        });
    })
    .catch((error) => {
        console.log('MongoDB connection error:', error);
    });
