const express = require('express')
const mongoose = require("mongoose");
const path = require('path');
const user = require('./models/userdataschem.js')

const app = express()
const port = 3000

// connect to mongo db data base with user info

mongoose.connect("mongodb://localhost:27017/userinfo")
  .then(() => console.log('MongoDB connected successfully'))
  .catch(err => console.log('MongoDB connection error:', err));

// middelwares
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.use(express.json());

app.get('/', (req, res) => {
  res.render('singuppage.ejs')
});

app.get('/mainpage',(req,res)=>{
  res.render('mainpage.ejs')
});

app.post('/newuser', async (req, res) => {
  try{
    console.log('📨 Received signup request:', req.body);
    const { username, email, password } = req.body;

    // printing the data to console 
    console.log(username)
    console.log(email)
    console.log(password)

    console.log('✅ Creating new user...');
    // creat newuser 
    const newuser = new user({
      name:username ,
      email: email,
      password: password
    });
    await newuser.save();
    console.log('✅ User saved successfully:')
    res.json({ reply: "welcome!", received: req.body });
  }catch(error){
    if(error.code==11000){
      console.log("user is alredy register")
      res.json({ e:'error occer' , message:"user is alredy register"})
    }
    if(error.name === 'ValidationError'){
    const firstError = Object.values(error.errors)[0];
    console.log(firstError.message)
    res.json({e:"error occer",message:firstError.message})
    }
  }
});
// starting the server
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
  console.log('Signup endpoint: POST http://localhost:3000/');
})
