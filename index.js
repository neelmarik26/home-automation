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
const { setupWebSocketServer } = require('./websocket/server');
const { registerUser, removeUser, registerEspStatusListener, removeEspStatusListener } = require('./websocket/connectionManager');

const app = express();
const server = http.createServer();

// Mount Express after WebSocket server is set up
// This prevents Express from intercepting WebSocket frames
setupWebSocketServer(server);

// WebSocket endpoint for frontend clients (receives ESP status updates)
// Using noServer mode to handle upgrades manually
const wssFrontend = new WebSocket.Server({ noServer: true });

wssFrontend.on('connection', (ws, req) => {
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

        // Send initial status
        ws.send(JSON.stringify({ type: 'connected', userId }));

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
});

wssFrontend.on('connection', (ws, req) => {
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

        // Send initial status
        ws.send(JSON.stringify({ type: 'connected', userId }));

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

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Mount Express on the server AFTER WebSocket setup
// This allows WebSocket to handle /ws and /ws-front, while Express handles everything else
server.on('request', app);

app.use('/user', userRoutes);
app.use('/admin', adminRoutes);

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
  .then(() => {
    console.log('MongoDB connected successfully');
    server.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });
  })
  .catch((error) => {
    console.log('MongoDB connection error:', error);
  });
