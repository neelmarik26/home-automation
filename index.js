require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const userRoutes = require('./routes/userRoutes');
const adminRoutes = require('./routes/adminRoutes');
const { addSocket, clearEspSocket, removeSocket, sendAllButtonsToUser, setEspSocket } = require('./helpers/websocketHelper');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

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

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.userId = null;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', async (message) => {
    try {
      const rawMessage = message.toString();
      const payload = JSON.parse(rawMessage);
      console.log('payload',payload)

      if (payload?.type === 'identify' && payload.userId) {
        addSocket(payload.userId, ws);
        await sendAllButtonsToUser(payload.userId);
        return;
      }

      if (payload?.type === 'esp-identify' && payload.deviceId) {
        setEspSocket(ws, payload.deviceId);
        return;
      }

      if (payload?.type === 'esp-identify') {
        setEspSocket(ws, 'esp32');
        return;
      }

      if (payload?.type === 'esp-status' || payload?.device === 'esp32') {
        setEspSocket(ws, payload.deviceId || payload.device || 'esp32');
        return;
      }
    } catch (error) {
      const rawMessage = message.toString();

      if (rawMessage === 'Hello from ESP32!' || rawMessage === 'esp32') {
        setEspSocket(ws, 'esp32');
        return;
      }

      console.log('WebSocket message error:', error.message);
    }
  });

  ws.on('close', () => {
    clearEspSocket(ws);
    removeSocket(ws);
  });

  ws.on('error', () => {
    clearEspSocket(ws);
    removeSocket(ws);
  });
});

const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      removeSocket(ws);
      return ws.terminate();
    }

    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(heartbeatInterval));

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
