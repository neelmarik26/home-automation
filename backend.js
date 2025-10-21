const express = require('express')
const mongoose = require("mongoose");
const cors = require('cors');
const path = require('path');
const user = require('./models/userdataschem.js')

const app = express()
// const port = 3000
let btn1sts = 0;
let btn2sts = 0;

// connect to mongo db data base with user info

mongoose.connect("mongodb+srv://neelmarik26_db_user:2hcODrH1Ratq8b0K@iothomeautomation.nayri10.mongodb.net/?retryWrites=true&w=majority&appName=IotHomeAutomation")
  .then(() => console.log('MongoDB connected successfully'))
  .catch(err => console.log('MongoDB connection error:', err));

// middelwares
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.use(express.json());

app.get('/singup', (req, res) => {
  res.render('singuppage.ejs')
});

app.get('/mainpage', (req, res) => {
  res.render('mainpage.ejs')
});

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

app.post('/newuser', async (req, res) => {
  try {
    console.log('📨 Received signup request:', req.body);
    const { username, email, password } = req.body;

    // printing the data to console 
    console.log(username)
    console.log(email)
    console.log(password)

    console.log('✅ Creating new user...');
    // creat newuser 
    const newuser = new user({
      name: username,
      email: email,
      password: password
    });
    await newuser.save();
    console.log('✅ User saved successfully:')
    res.json({ reply: "welcome!", received: req.body });
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

app.get("/esp", (req, res) => {
  res.json({
    button1: btn1sts,
    button2: btn2sts
  });
});

app.get("/", (req, res) => {
  res.json({ message: "Server is running!" });
});

// starting the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
  console.log('Signup endpoint: POST http://localhost:3000/singup');
})
