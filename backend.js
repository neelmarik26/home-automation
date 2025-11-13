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
  // local host
  // mongoose.connect("mongodb://localhost:27017/")
  .then(() => console.log('MongoDB connected successfully'))
  .catch(err => console.log('MongoDB connection error:', err));
//  at frist get all sts from data base and set to variable
async function initializeButtonStates() {
  try {
    const buttons = await ButtonState.find({});
    buttons.forEach(button => {
      switch (button.buttonName) {
        case 'btn1':
          btn1sts = parseInt(button.state);
          break;
        case 'btn2':
          btn2sts = parseInt(button.state);
          break;
        case 'btn3':
          btn3sts = parseInt(button.state);
          break;
        case 'btn4':
          btn4sts = parseInt(button.state);
          break;
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
// end.....................................

// post request start from here ......................

app.post("/start", async(req, res) => {
  await initializeButtonStates();
  res.json({ button1:btn1sts, button2:btn2sts, button3:btn3sts, button4:btn4sts });
});
app.post('/mainpagetoken', async (req, res) => {
  const { usertoken } = req.body;
  console.log(usertoken)
  // const token = await user.findOne({_id:usertoken });
  try {
    const token = await user.findOne({ _id: usertoken });
    if (token) {
      console.log("token is found")
      res.json({ message: "token is found" })
    }
    else {
      res.json({ message: "token is not found" })
    }
  }

  catch (e) {
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
      // Update button state only if ID is valid
      if (id === "btn1") {
        btn1sts = status
        console.log("button1 sts is ==>", btn1sts)
        espSocket.send(JSON.stringify({ button: id, status: btn1sts }));
        res.json({ reply: "working on your request", received: req.body });
      }
      else if (id === "btn2") {
        btn2sts = status
        console.log("button2 sts is ==>", btn2sts)
        espSocket.send(JSON.stringify({ button: id, status: btn2sts }));
        res.json({ reply: "working on your request", received: req.body });
      } else if (id === "btn3") {
        btn3sts = status
        console.log("button3 sts is ==>", btn3sts)
        espSocket.send(JSON.stringify({ button: id, status: btn3sts }));
        res.json({ reply: "working on your request", received: req.body });
      } else if (id === "btn4") {
        btn4sts = status
        console.log("button4 sts is ==>", btn4sts)
        espSocket.send(JSON.stringify({ button: id, status: btn4sts }));
        res.json({ reply: "working on your request", received: req.body });
      } else {
        res.status(400).json({ error: "Invalid button ID" });
      }
    }
    catch (e) {
      res.json({ reply: "error occer ", err: e.message })
    }
  }
});

// for old user login 
app.post('/olduser', async (req, res) => {
  console.log('get request for login');
  const { email, password } = req.body;
  console.log('email:' + email)
  console.log("password:" + password)

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
    console.log(`User locked. Wait ${waitTime}s`);
    return res.json({
      reply: `Too many failed attempts.`,
      remaining: waitTime,
      message: 'locked',
    });
  }

  // console.log('user found')
  // console.log(olduser)
  const sts = await checkPassword(password, olduser.password)
  console.log("password match sts ==>", sts);
  if (sts) {
    console.log(`Wrong password. Attempts: ${attemptInfo.attempts}`);
    res.json({ reply: 'user found', pass: 'match', token: olduser._id })
  }
  else {
    attemptInfo.attempts += 1;
    console.log('password not match pls enter right password');
    if (attemptInfo.attempts >= 5) {
      // lock account
      attemptInfo.lockUntil = now + attemptInfo.lockDuration;
      attemptInfo.attempts = 0;
      attemptInfo.lockDuration *= 2; // double lock time every 5 failures

      const waitTime = (attemptInfo.lockDuration / 1000) / 2;
      console.log(`Account locked for ${waitTime}s`);
      return res.json({
        reply: `Too many failed attempts.`,
        remaining: waitTime,
        message: 'locked',
      });
    }
    return res.json({
      reply: `${5 - attemptInfo.attempts} attempts left.`,
      pass: 'notmatch',
      message: " password not match. enter a right password.",
    });
  }
}
)
// for nwe user sign up 
app.post('/newuser', async (req, res) => {
  try {
    console.log('📨 Received signup request:', req.body);
    const { username, email, password } = req.body;

    // printing the data to console 
    console.log(username)
    console.log(email)
    // console.log(password)
    const encriptpass = await hashpassword(password);
    console.log(encriptpass)
    console.log('✅ Creating new user...');
    // creat newuser 
    const newuser = new user({
      name: username,
      email: email,
      password: encriptpass
    });
    await newuser.save();
    console.log('✅ User saved successfully:')
    const olduser = await user.findOne({ email: email });
    res.json({ reply: "welcome!", received: req.body.email, token: olduser._id });
  } catch (error) {
    if (error.code == 11000) {
      console.log("user is alredy register")
      res.json({ e: 'error occer', message: "user is alredy register" })
    }
    if (error.name === 'ValidationError') {
      const firstError = Object.values(error.errors)[0];
      console.log(firstError.message)
      res.json({ e: "error occer", message: firstError.message })
    }
  }
});
app.post("/userdeleatbyid", async (req, res) => {
  const userid = req.body.userid;
  console.log(userid)
  try {
    const deletedUser = await user.findByIdAndDelete(userid);
    if (deletedUser) {
      console.log("User deleted:", deletedUser.name);
      res.json({ message: `user deleat ${deletedUser.name}`, action: "deleat" })
    } else {
      console.log("No user found with this ID");
      res.json({ message: `no user found releted this id` })
    }
  } catch (error) {
    console.error("Error deleting user:", err);
    res.json({ message: " error comming" })
  }
})

// send mail to user 

const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications["api-key"];// my apui kyyy 
apiKey.apiKey = process.env.e_mail_api; // your Brevo key
const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();


app.post("/sendmail", async (req, res) => {
  const { usermail, otp } = req.body
  console.log(usermail, otp)
  const sendSmtpEmail = {
    sender: { name: "Neel from IoT", email: "neelmarik26@gmail.com" },
    to: [{ email: usermail }],
    subject: "Your Verification Code",
    htmlContent: `
      <p>Hi there,</p>
      <p>Your one-time verification code is:</p>
      <h2 style="color:#2e6c80;">${otp}</h2>
      <p>This code will expire in 10 minutes.</p>
      <p>If you didn’t request this, please ignore this message.</p>
      <br>
      <p>– The IoT Team</p>
    `,
  };

  try {
    await apiInstance.sendTransacEmail(sendSmtpEmail);
    res.json({ message: " i get this", otp: otp })
  } catch (error) {
    res.json({ message: "not done", error: error.message });
  }
});
// chenge pass word to esp wifi 
app.post("/esp_cpass", async (req, res) => {
  const { ssid, password } = req.body;
  console.log("new ssid is ==>", ssid);
  console.log("new password is ==>", password);
  if (espSocket && espSocket.readyState === WebSocket.OPEN) {
    try {
      espSocket.send(JSON.stringify({ ssid: ssid, password: password }));
      res.json({ message: "esp pass word change request sent" })
    } catch (e) {
      console.log("error occer while sending data to esp", e.message);
      res.json({ message: "error occer while sending data to esp", error: e.message })
    }
  }
  else {
    console.log("esp is not connected");
    res.json({ message: "esp is not connected" });
  }
});
// change passwort to data base
app.post("/cpass", async (req, res) => {
  const { usermail, newpassword } = req.body;
  const haspass = await hashpassword(newpassword);
  try {
    const olduser = await user.findOne({ email: usermail });
    if (!olduser) {
      res.json({ message: "user not found" })
    }
    else {
      olduser.password = haspass;
      await olduser.save();
      console.log("Password updated successfully");
      const sendSmtpEmail = {
        sender: { name: "Neel from IoT", email: "neelmarik26@gmail.com" },
        to: [{ email: usermail }],
        subject: "security :password update succes fully",
        htmlContent: `
      <p>Hi there,</p>
      <p>your password is update successfylly and password is:</p>
      <h2 style="color:#2e6c80;">${newpassword}</h2>
      <p>keep connect with us </p>
      <p>welcome</p>
      <br>
      <p>-The IoT Team</p>
    `,
      };
      await apiInstance.sendTransacEmail(sendSmtpEmail);
      res.json({ message: "Password updated successfully" })
    }
  } catch (e) {
    console.error("Error updating password:", e);
    res.json({ message: "Error updating password" })
  }
})
// all post request end here.........................
// websocket connection with esp............

wss.on("connection", async (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log("ESP connected via WebSocket.ip is :", ip);
  await initializeButtonStates();
  // send initial button states to ESP
  ws.send(JSON.stringify({ button: "btn1", status: btn1sts }));
  ws.send(JSON.stringify({ button: "btn2", status: btn2sts }));
  ws.send(JSON.stringify({ button: "btn3", status: btn3sts }));
  ws.send(JSON.stringify({ button: "btn4", status: btn4sts }));
  espSocket = ws;
  // hendel message from esp
  ws.on("message", (msg) => {
    console.log("Received from ESP:", msg.toString());
  });
  // close connection 
  ws.on("close", () => {
    console.log("Client disconnected,reconnect when esp is on");
    espSocket = null;
  });
});

// web socket connection end here............
// all get request is here.............................
app.get("/supage", (req, res) => {
  try {
    res.render('singuppage.ejs')
  } catch (err) {
    console.log('errrr', err)
  }
});

app.get('/mainpage', (req, res) => {
  res.render('mainpage.ejs')
});

app.get("/alluserinfo", async (req, res) => {
  console.log("find all user data")
  try {
    const users = await user.find(); // ← this gets all users
    // console.log(users);
    res.json(users)
  } catch (err) {
    console.error('Error fetching users:', err);
    res.json({ message: "there is some thing wrong" })
  }
})

app.get('/', (req, res) => {
  res.render('login.ejs')
});

// ,,,,,,,,,,.....................................................................

// all function write here 

// hased a password
async function hashpassword(password) {
  const saltrounds = 10;
  const hashedpassword = await bcrypt.hash(password, saltrounds);
  return hashedpassword;
}

// cheak the password is match or not
async function checkPassword(plainPassword, hashedPassword) {
  const match = await bcrypt.compare(plainPassword, hashedPassword);
  return match; // true if correct
}

// starting the server
const port = process.env.PORT || 10000;
server.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
  console.log(`Signup endpoint: POST http://localhost:${port}/`);
})
