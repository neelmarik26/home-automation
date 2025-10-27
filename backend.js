const express = require("express")
require('dotenv').config();
const mongoose = require("mongoose");
const cors = require('cors');
const bcrypt = require('bcrypt');
const path = require('path');
const user = require('./models/userdataschem.js')
const nodemailer = require("nodemailer");

const app = express()
let btn1sts = 0;
let btn2sts = 0;
const loginAttempts = {};
// connect to mongo db data base with user info

mongoose.connect("mongodb+srv://neelmarik26_db_user:2hcODrH1Ratq8b0K@iothomeautomation.nayri10.mongodb.net/?retryWrites=true&w=majority&appName=IotHomeAutomation")
  // local host
  // mongoose.connect("mongodb://localhost:27017/")

  .then(() => console.log('MongoDB connected successfully'))
  .catch(err => console.log('MongoDB connection error:', err));

// middelwares
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.use(express.json());
// app.use(express.text({ type: '*/*' }));



app.get("/supage", (req, res) => {
  try {
    res.render('singuppage.ejs')
  } catch (err) {
    console.log('errrr', err)
  }
})
app.get('/mainpage', (req, res) => {
  res.render('mainpage.ejs')
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
  }

  catch (e) {
    console.log("toke is not found")
    res.json({ message: "token is not found" })
  }
})

app.post('/mainpagedata', async (req, res) => {
  // console.log("received requstfrom main page ")
  const { id, status } = req.body;
  console.log(id + "---" + status)
  if (id == "btn1") {
    if (status == 1) {
      btn1sts = 1;
    }
    else {
      btn1sts = 0;
    }
  }
  if (id == "btn2") {
    if (status == 1) {
      btn2sts = 1;
    }
    else {
      btn2sts = 0;
    }
  }
  res.json({ reply: "working on your request", received: req.body });
})
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
app.post("/sendmail", async (req, res) => {
  const { usermail, otp } = req.body
  console.log(usermail, otp)
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "neelmarik26@gmail.com",
        pass: "nhel vbgd nesl iqqc" // use Gmail app password
      }
    });

    await transporter.sendMail({
      from: "neelmarik26@gmail.com",
      to: usermail,
      subject: "Your Verification Code",
      html: `
    <p>Hi there,</p>
    <p>Your one-time verification code is:</p>
    <h2 style="color:#2e6c80;">${otp}</h2>
    <p>This code will expire in 10 minutes.</p>
    <p>If you didn’t request this, please ignore this message.</p>
    <br>
    <p>– The iot Team</p>
  `
    });

    res.json({ message: " i get this" ,otp:otp })
  } catch (error) {
    res.json({ message: "not done", error: error.message });
  }
});

app.get("/esp", (req, res) => {
  res.json({
    button1: btn1sts,
    button2: btn2sts
  });
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
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
  console.log('Signup endpoint: POST http://localhost:3000/');
})
