const express = require("express")
require('dotenv').config();
const mongoose = require("mongoose");
const cors = require('cors');
const bcrypt = require('bcrypt');
const path = require('path');
const user = require('./models/userdataschem.js')
const ButtonState = require("./models/LAST5BUTTON.js");
const SibApiV3Sdk = require("sib-api-v3-sdk");
const WebSocket = require("ws");
const http = require("http");

const app = express()
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// gloubal variable  write here ..................
let btn1sts = 0;
let btn2sts = 0;
let btn3sts = 0;
let btn4sts = 0;
let espSocket = null;
const loginAttempts = {};

// connect to mongo db data base with user info
mongoose.connect(process.env.mongodb_url)
  .then(() => console.log('MongoDB connected successfully'))
  .catch(err => console.log('MongoDB connection error:', err));

async function initializeButtonStates() {
  try {
    const buttons = await ButtonState.find({});
    buttons.forEach(button => {
      switch (button.buttonName) {
        case 'btn1': btn1sts = parseInt(button.state); break;
        case 'btn2': btn2sts = parseInt(button.state); break;
        case 'btn3': btn3sts = parseInt(button.state); break;
        case 'btn4': btn4sts = parseInt(button.state); break;
      }
    })
    console.log("Initial button states loaded:", { btn1sts, btn2sts, btn3sts, btn4sts });
  } catch (e) {
    console.error("Error initializing button states:", e.message);
  }
};

// middelwares
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.use(express.json());

// ================================================================
// ALL POST ROUTES
// ================================================================

app.post("/start", async(req, res) => {
  await initializeButtonStates();
  res.json({ button1:btn1sts, button2:btn2sts, button3:btn3sts, button4:btn4sts });
});

app.post('/mainpagetoken', async (req, res) => {
  const { usertoken } = req.body;
  console.log(usertoken)
  try {
    const token = await user.findOne({ _id: usertoken });
    if (token) {
      console.log("token is found")
      res.json({ message: "token is found" })
    } else {
      res.json({ message: "token is not found" })
    }
  } catch (e) {
    console.log("toke is not found")
    res.json({ message: "token is not found" })
  }
})

app.post("/mainpagedata", async (req, res) => {
  const { id, status } = req.body;
  console.log(id + " --- " + status);
  await ButtonState.findOneAndUpdate(
    { buttonName: id },
    { state: status, timestamp: Date.now() },
    { upsert: true, new: true }
  );
  if (espSocket && espSocket.readyState === WebSocket.OPEN) {
    try {
      if (id === "btn1") {
        btn1sts = status
        espSocket.send(JSON.stringify({ button: id, status: btn1sts }));
        res.json({ reply: "working on your request", received: req.body });
      } else if (id === "btn2") {
        btn2sts = status
        espSocket.send(JSON.stringify({ button: id, status: btn2sts }));
        res.json({ reply: "working on your request", received: req.body });
      } else if (id === "btn3") {
        btn3sts = status
        espSocket.send(JSON.stringify({ button: id, status: btn3sts }));
        res.json({ reply: "working on your request", received: req.body });
      } else if (id === "btn4") {
        btn4sts = status
        espSocket.send(JSON.stringify({ button: id, status: btn4sts }));
        res.json({ reply: "working on your request", received: req.body });
      } else {
        res.status(400).json({ error: "Invalid button ID" });
      }
    } catch (e) {
      res.json({ reply: "error occer ", err: e.message })
    }
  }
});

app.post('/olduser', async (req, res) => {
  console.log('get request for login');
  const { email, password } = req.body;
  const olduser = await user.findOne({ email: email });
  if (!olduser) {
    console.log('no user found')
    res.json({ reply: "no user found" })
  }
  if (!loginAttempts[email]) {
    loginAttempts[email] = { attempts: 0, lockUntil: 0, lockDuration: 60000 };
  }
  const attemptInfo = loginAttempts[email];
  const now = Date.now();
  if (now < attemptInfo.lockUntil) {
    const waitTime = Math.ceil((attemptInfo.lockUntil - now) / 1000);
    return res.json({ reply: `Too many failed attempts.`, remaining: waitTime, message: 'locked' });
  }
  const sts = await checkPassword(password, olduser.password)
  if (sts) {
    res.json({ reply: 'user found', pass: 'match', token: olduser._id })
  } else {
    attemptInfo.attempts += 1;
    if (attemptInfo.attempts >= 5) {
      attemptInfo.lockUntil = now + attemptInfo.lockDuration;
      attemptInfo.attempts = 0;
      attemptInfo.lockDuration *= 2;
      const waitTime = (attemptInfo.lockDuration / 1000) / 2;
      return res.json({ reply: `Too many failed attempts.`, remaining: waitTime, message: 'locked' });
    }
    return res.json({ reply: `${5 - attemptInfo.attempts} attempts left.`, pass: 'notmatch', message: "password not match." });
  }
})

app.post('/newuser', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const encriptpass = await hashpassword(password);
    const newuser = new user({ name: username, email: email, password: encriptpass });
    await newuser.save();
    const olduser = await user.findOne({ email: email });
    res.json({ reply: "welcome!", received: req.body.email, token: olduser._id });
  } catch (error) {
    if (error.code == 11000) res.json({ e: 'error occer', message: "user is alredy register" })
    if (error.name === 'ValidationError') {
      const firstError = Object.values(error.errors)[0];
      res.json({ e: "error occer", message: firstError.message })
    }
  }
});

app.post("/userdeleatbyid", async (req, res) => {
  const userid = req.body.userid;
  try {
    const deletedUser = await user.findByIdAndDelete(userid);
    if (deletedUser) {
      res.json({ message: `user deleat ${deletedUser.name}`, action: "deleat" })
    } else {
      res.json({ message: `no user found releted this id` })
    }
  } catch (error) {
    res.json({ message: " error comming" })
  }
})

const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications["api-key"];
apiKey.apiKey = process.env.e_mail_api;
const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

app.post("/sendmail", async (req, res) => {
  const { usermail, otp } = req.body
  const sendSmtpEmail = {
    sender: { name: "Neel from IoT", email: "neelmarik26@gmail.com" },
    to: [{ email: usermail }],
    subject: "Your Verification Code",
    htmlContent: `<p>Hi there,</p><p>Your one-time verification code is:</p><h2 style="color:#2e6c80;">${otp}</h2><p>This code will expire in 10 minutes.</p><p>– The IoT Team</p>`,
  };
  try {
    await apiInstance.sendTransacEmail(sendSmtpEmail);
    res.json({ message: " i get this", otp: otp })
  } catch (error) {
    res.json({ message: "not done", error: error.message });
  }
});

app.post("/esp_cpass", async (req, res) => {
  const { ssid, password } = req.body;
  if (espSocket && espSocket.readyState === WebSocket.OPEN) {
    try {
      espSocket.send(JSON.stringify({ ssid: ssid, password: password }));
      res.json({ message: "esp pass word change request sent" })
    } catch (e) {
      res.json({ message: "error occer while sending data to esp", error: e.message })
    }
  } else {
    res.json({ message: "esp is not connected" });
  }
});

app.post("/cpass", async (req, res) => {
  const { usermail, newpassword } = req.body;
  const haspass = await hashpassword(newpassword);
  try {
    const olduser = await user.findOne({ email: usermail });
    if (!olduser) {
      res.json({ message: "user not found" })
    } else {
      olduser.password = haspass;
      await olduser.save();
      const sendSmtpEmail = {
        sender: { name: "Neel from IoT", email: "neelmarik26@gmail.com" },
        to: [{ email: usermail }],
        subject: "security :password update succes fully",
        htmlContent: `<p>Hi there,</p><p>your password is update successfylly and password is:</p><h2 style="color:#2e6c80;">${newpassword}</h2><p>– The IoT Team</p>`,
      };
      await apiInstance.sendTransacEmail(sendSmtpEmail);
      res.json({ message: "Password updated successfully" })
    }
  } catch (e) {
    res.json({ message: "Error updating password" })
  }
})

// ================================================================
// ✅ WEBSOCKET WITH HEARTBEAT — REPLACES OLD wss.on("connection")
// ================================================================

const HEARTBEAT_INTERVAL = 20000; // ping every 20 seconds

function heartbeat() {
  this.isAlive = true; // called when pong is received from client
}

wss.on("connection", async (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log("✅ ESP connected via WebSocket. IP:", ip);

  // Mark connection as alive and listen for pong replies
  ws.isAlive = true;
  ws.on("pong", heartbeat);

  await initializeButtonStates();

  // Send initial button states to ESP
  ws.send(JSON.stringify({ button: "btn1", status: btn1sts }));
  ws.send(JSON.stringify({ button: "btn2", status: btn2sts }));
  ws.send(JSON.stringify({ button: "btn3", status: btn3sts }));
  ws.send(JSON.stringify({ button: "btn4", status: btn4sts }));

  espSocket = ws;

  ws.on("message", (msg) => {
    const text = msg.toString();
    console.log("📨 Received from ESP:", text);

    // Reply to text pings from ESP32
    if (text === "ping" || text === '{"type":"ping"}') {
      ws.send("pong");
      console.log("💓 Sent pong to ESP");
    }
  });

  ws.on("close", () => {
    console.log("🔌 ESP disconnected");
    espSocket = null;
  });

  ws.on("error", (err) => {
    console.log("❌ WebSocket error:", err.message);
  });
});

// Server pings all clients every 20s — if no pong back, kill the dead connection
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log("💀 Client failed heartbeat check, terminating");
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping(); // send WebSocket-level ping
  });
}, HEARTBEAT_INTERVAL);

wss.on("close", () => clearInterval(interval));

// ================================================================
// ALL GET ROUTES
// ================================================================

app.get("/supage", (req, res) => {
  try { res.render('singuppage.ejs') } catch (err) { console.log('errrr', err) }
});

app.get('/mainpage', (req, res) => { res.render('mainpage.ejs') });

app.get("/alluserinfo", async (req, res) => {
  try {
    const users = await user.find();
    res.json(users)
  } catch (err) {
    res.json({ message: "there is some thing wrong" })
  }
})

app.get('/', (req, res) => { res.render('login.ejs') });

// ================================================================
// UTILITY FUNCTIONS
// ================================================================

async function hashpassword(password) {
  const saltrounds = 10;
  return await bcrypt.hash(password, saltrounds);
}

async function checkPassword(plainPassword, hashedPassword) {
  return await bcrypt.compare(plainPassword, hashedPassword);
}

// Start server
const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`✅ Server listening on port ${port}`)
})
