const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');
const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransport({
  service: "gmail", // or another email provider
  auth: {
    user: process.env.email, // your email address
    pass: process.env.email_password // NOT your normal Gmail password
  }
});


const User = require('../models/userdataschem');
const ButtonState = require('../models/LAST5BUTTON');
const { getEspWebSocket } = require('../websocket/connectionManager');

function isStrongPassword(password) {
  return (
    typeof password === 'string' &&
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password) &&
    /[@$!%*?&]/.test(password)
  );
}

function createToken(user) {
  return jwt.sign(
    {
      id: user._id,
      name: user.name,
      email: user.email,
      type: user.type,
      status: user.status,
    },
    process.env.token,
    { expiresIn: '7d' }
  );
}

async function seedDefaultButtons(userId) {
  const defaultButtons = ['btn1', 'btn2', 'btn3', 'btn4'].map((buttonName) => ({
    buttonName,
    state: '0',
    type: 'USER',
    userId,
  }));

  await ButtonState.insertMany(defaultButtons);
}

exports.registerUser = async (req, res) => {
  let createdUser = null;

  try {
    const { email, username, password } = req.body;

    if (!email || !username || !password) {
      return res.status(400).json({ message: 'email, username, and password are required' });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({
        message: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: 'user is already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    createdUser = await User.create({
      name: username,
      email,
      password: hashedPassword,
      type: 'USER',
      status: 'ACTIVE',
    });

    await seedDefaultButtons(createdUser._id);

    return res.status(201).json({
      message: 'welcome!',
      user: {
        id: createdUser._id,
        name: createdUser.name,
        email: createdUser.email,
      },
    });
  } catch (error) {
    if (createdUser?._id) {
      await Promise.all([
        ButtonState.deleteMany({ userId: createdUser._id }),
        User.deleteOne({ _id: createdUser._id }),
      ]);
    }

    if (error.code === 11000) {
      return res.status(409).json({ message: 'user is already registered' });
    }

    return res.status(500).json({ message: 'error occurred while registering user', error: error.message });
  }
};

exports.loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    // console.log('Login request received:', { email, password });
    if (!email || !password) {
      return res.status(400).json({ message: 'email and password are required' });
    }

    const existingUser = await User.findOne({ email });
    if (!existingUser) {
      return res.status(404).json({ reply: 'no user found' });
    }

    if (existingUser.status === 'BLOCKED') {
      return res.status(401).json({ message: 'user is blocked' });
    }

    const passwordMatch = await bcrypt.compare(password, existingUser.password);
    if (!passwordMatch) {
      return res.status(401).json({
        message: 'password not match.',
      });
    }

    const token = createToken(existingUser);

    return res.json({
      message: 'user found',
      token,
      user: {
        id: existingUser._id,
        name: existingUser.name,
        email: existingUser.email,
        type: existingUser.type,
        status: existingUser.status,
      },
    });
  } catch (error) {
    // console.log('Error during login:', error);
    return res.status(500).json({ message: 'error occurred while logging in', error: error.message });
  }
};

exports.sendForgotPasswordOtp = async (req, res) => {
  try {
    const { usermail } = req.body;
    console.log("user email is ==> " + usermail);
    if (!usermail) {
      return res.status(400).json({ message: 'email is required' });
    }

    const existingUser = await User.findOne({ email: usermail });
    if (!existingUser) {
      return res.status(404).json({ message: 'user not found' });
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    // console.log("Generated OTP is ==> " + otp);
    existingUser.passwordResetOtp = otp;
    existingUser.passwordResetOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await existingUser.save();

    await transporter.sendMail({
      from: process.env.email,
      to: usermail,
      subject: "Your OTP Code",
      text: `welcome!,Your OTP code is: ${otp}`
    });

    res.send({ status: true, message: "Email sent successfully", otp: otp })
  } catch (error) {
    return res.status(500).json({ status: false, message: 'failed to send otp', error: error.message });
  }
};

exports.verifyOtpAndResetPassword = async (req, res) => {
  const { usermail, newpassword } = req.body;
  const haspass = await bcrypt.hash(newpassword, 10);
  try {
    const olduser = await User.findOne({ email: usermail });
    if (!olduser) {
      res.json({ message: "user not found" })
    }
    else {
      olduser.password = haspass;
      await olduser.save();
      await transporter.sendMail({
        from: process.env.email,
        to: usermail,
        subject: "Password Updated",
        text: `welcome!,Your password has been updated to ${newpassword} successfully.`
      });
      res.json({ message: "Password updated successfully" })
    }
  } catch (e) {
    res.json({ message: "Error updating password" })
  }
};

exports.getButtonStatusByUser = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: 'unauthorized' });
    }

    const buttonStatus = await ButtonState.find({
      userId,
      type: 'USER',
    }).sort({ buttonName: 1 });

    return res.json({
      userId,
      buttons: buttonStatus,
    });
  } catch (error) {
    return res.status(500).json({ message: 'failed to fetch button status', error: error.message });
  }
};

exports.updateButtonStatusByUser = async (req, res) => {
  try {
    const userId = req.user?.id;
    const buttonId = req.params.buttonId || req.body.buttonId;
    const { status } = req.body;

    if (!buttonId) {
      return res.status(400).json({ message: 'button id is required' });
    }

    const updatedButton = await ButtonState.findOneAndUpdate(
      {
        _id: buttonId,
        userId,
        type: 'USER',
      },
      {
        state: String(status),
        timestamp: Date.now(),
      },
      { new: true }
    );

    if (!updatedButton) {
      return res.status(404).json({ message: 'button not found' });
    }

    // Send button update to ESP via WebSocket
    const espWs = getEspWebSocket(userId);
    if (espWs && espWs.readyState === WebSocket.OPEN) {
      espWs.send(JSON.stringify({
        type: 'button_update',
        button: updatedButton.buttonName,
        status: parseInt(updatedButton.state)
      }));
    }

    return res.json({
      message: 'button status updated successfully',
      button: updatedButton,
    });
  } catch (error) {
    return res.status(500).json({ message: 'failed to update button status', error: error.message });
  }
};
