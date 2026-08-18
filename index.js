require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const http = require('http');

const userRoutes = require('./routes/userRoutes');
const adminRoutes = require('./routes/adminRoutes');
const timerRoutes = require('./routes/timerRoutes');
const { loadActiveTimers } = require('./controllers/timerController');
require('./mqtt/mqttService');

const app = express();
const server = http.createServer();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

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
