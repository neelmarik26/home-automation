const express = require("express")
require('dotenv').config();
const mongoose = require("mongoose");
const cors = require('cors');
const bcrypt = require('bcrypt');
const path = require('path');
const https = require("https");
const user = require('./models/userdataschem.js')
const ButtonState = require("./models/LAST5BUTTON.js");
const SibApiV3Sdk = require("sib-api-v3-sdk");

const app = express()
const FIREBASE_DATABASE_URL = (process.env.FIREBASE_DATABASE_URL || "home-automation-77e6c-default-rtdb.firebaseio.com")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");
const FIREBASE_DATABASE_SECRET = process.env.FIREBASE_DATABASE_SECRET || "3hHetqM0wMhHRfCJsbwokl1Neo2INtsxbs7Br6Hc";
// gloubal variable  write here ..................
let btn1sts = 0;
let btn2sts = 0;
let btn3sts = 0;
let btn4sts = 0;
const loginAttempts = {};

function normalizeButtonState(value) {
  return value === 1 || value === "1" || value === true ? 1 : 0;
}

function currentButtonSnapshot() {
  return {
    button1: btn1sts,
    button2: btn2sts,
    button3: btn3sts,
    button4: btn4sts,
  };
}

function applyButtonSnapshot(snapshot = {}) {
  btn1sts = normalizeButtonState(snapshot.btn1 ?? snapshot.button1 ?? 0);
  btn2sts = normalizeButtonState(snapshot.btn2 ?? snapshot.button2 ?? 0);
  btn3sts = normalizeButtonState(snapshot.btn3 ?? snapshot.button3 ?? 0);
  btn4sts = normalizeButtonState(snapshot.btn4 ?? snapshot.button4 ?? 0);
}

function firebaseRequest(method, firebasePath, payload) {
  const normalizedPath = !firebasePath || firebasePath === "/"
    ? ""
    : firebasePath.startsWith("/")
      ? firebasePath
      : `/${firebasePath}`;

  const requestBody = payload === undefined ? null : JSON.stringify(payload);
  const options = {
    method,
    hostname: FIREBASE_DATABASE_URL,
    path: `${normalizedPath}.json?auth=${encodeURIComponent(FIREBASE_DATABASE_SECRET)}`,
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (requestBody) {
    options.headers["Content-Length"] = Buffer.byteLength(requestBody);
  }

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          return reject(new Error(`Firebase request failed (${res.statusCode}): ${data}`));
        }
        if (!data) {
          return resolve(null);
        }
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          resolve(data);
        }
      });
    });

    req.on("error", reject);
    if (requestBody) {
      req.write(requestBody);
    }
    req.end();
  });
}

async function readFirebaseButtonState() {
  const snapshot = await firebaseRequest("GET", "/");
  return {
    btn1: normalizeButtonState(snapshot?.btn1),
    btn2: normalizeButtonState(snapshot?.btn2),
    btn3: normalizeButtonState(snapshot?.btn3),
    btn4: normalizeButtonState(snapshot?.btn4),
  };
}

async function syncButtonStatesToFirebase() {
  await firebaseRequest("PATCH", "/", {
    btn1: btn1sts,
    btn2: btn2sts,
    btn3: btn3sts,
    btn4: btn4sts,
  });
}

async function syncSingleButtonToFirebase(id, status) {
  const payload = { [id]: normalizeButtonState(status) };
  await firebaseRequest("PATCH", "/", payload);
}

async function syncWiFiCredentialsToFirebase(ssid, password) {
  await firebaseRequest("PATCH", "/", {
    wifi_ssid: ssid,
    wifi_password: password,
    wifi_version: Math.floor(Date.now() / 1000),
  });
}

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
    const snapshot = {};
    buttons.forEach(button => {
      switch (button.buttonName) {
        case 'btn1':
          snapshot.btn1 = parseInt(button.state);
          break;
        case 'btn2':
          snapshot.btn2 = parseInt(button.state);
          break;
        case 'btn3':
          snapshot.btn3 = parseInt(button.state);
          break;
        case 'btn4':
          snapshot.btn4 = parseInt(button.state);
          break;
      }
    });
    applyButtonSnapshot(snapshot);
    await syncButtonStatesToFirebase();
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
  try {
    const firebaseStates = await readFirebaseButtonState();
    applyButtonSnapshot(firebaseStates);
  } catch (error) {
    console.warn("Firebase state read failed, falling back to MongoDB:", error.message);
    await initializeButtonStates();
  }
  res.json(currentButtonSnapshot());
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
  const normalizedStatus = normalizeButtonState(status);

  try {
    if (id === "btn1") {
      await ButtonState.findOneAndUpdate(
        { buttonName: id },
        { state: normalizedStatus, timestamp: Date.now() },
        { upsert: true, new: true }
      );
      btn1sts = normalizedStatus;
    }
    else if (id === "btn2") {
      await ButtonState.findOneAndUpdate(
        { buttonName: id },
        { state: normalizedStatus, timestamp: Date.now() },
        { upsert: true, new: true }
      );
      btn2sts = normalizedStatus;
    }
    else if (id === "btn3") {
      await ButtonState.findOneAndUpdate(
        { buttonName: id },
        { state: normalizedStatus, timestamp: Date.now() },
        { upsert: true, new: true }
      );
      btn3sts = normalizedStatus;
    }
    else if (id === "btn4") {
      await ButtonState.findOneAndUpdate(
        { buttonName: id },
        { state: normalizedStatus, timestamp: Date.now() },
        { upsert: true, new: true }
      );
      btn4sts = normalizedStatus;
    } else if (id === "all") {
      await Promise.all([
        ButtonState.findOneAndUpdate(
          { buttonName: "btn1" },
          { state: normalizedStatus, timestamp: Date.now() },
          { upsert: true, new: true }
        ),
        ButtonState.findOneAndUpdate(
          { buttonName: "btn2" },
          { state: normalizedStatus, timestamp: Date.now() },
          { upsert: true, new: true }
        ),
        ButtonState.findOneAndUpdate(
          { buttonName: "btn3" },
          { state: normalizedStatus, timestamp: Date.now() },
          { upsert: true, new: true }
        ),
        ButtonState.findOneAndUpdate(
          { buttonName: "btn4" },
          { state: normalizedStatus, timestamp: Date.now() },
          { upsert: true, new: true }
        ),
      ]);
      btn1sts = normalizedStatus;
      btn2sts = normalizedStatus;
      btn3sts = normalizedStatus;
      btn4sts = normalizedStatus;
    } else {
      return res.status(400).json({ error: "Invalid button ID" });
    }

    if (id === "all") {
      await firebaseRequest("PATCH", "/", {
        btn1: normalizedStatus,
        btn2: normalizedStatus,
        btn3: normalizedStatus,
        btn4: normalizedStatus,
        all: normalizedStatus,
      });
    } else {
      await syncSingleButtonToFirebase(id, normalizedStatus);
    }

    res.json({ reply: "working on your request", received: req.body });
  }
  catch (e) {
    res.status(500).json({ reply: "error occer ", err: e.message })
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
  try {
    await syncWiFiCredentialsToFirebase(ssid, password);
    res.json({ message: "esp pass word change request sent" });
  } catch (e) {
    console.log("error occer while saving wifi settings to firebase", e.message);
    res.status(500).json({ message: "error occer while sending data to esp", error: e.message });
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
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
  console.log(`Signup endpoint: POST http://localhost:${port}/`);
})
