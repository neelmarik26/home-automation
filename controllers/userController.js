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
    customName: null,
    customRoom: null,
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
    console.log('Existing user check:', existingUser);
    if (existingUser) {
      console.log('User already registered:', existingUser);
      return res.status(409).json({ message: 'user is already registered' });
    }
    console.log('faaaaaaa')
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
      console.error('Duplicate key error:', error);
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
      return res.status(404).json({ message: 'no user found' });
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
    existingUser.passwordResetOtp = otp;
    existingUser.passwordResetOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await existingUser.save();

    await transporter.sendMail({
      from: process.env.email,
      to: usermail,
      subject: "Your OTP Code",
      text: `welcome!,Your OTP code is: ${otp}`
    });

    res.send({ status: true, message: "Email sent successfully" })
  } catch (error) {
    return res.status(500).json({ status: false, message: 'failed to send otp', error: error.message });
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    const { usermail, otp } = req.body;
    
    if (!usermail || !otp) {
      return res.status(400).json({ message: 'email and otp are required' });
    }

    const existingUser = await User.findOne({ email: usermail });
    if (!existingUser) {
      return res.status(404).json({ message: 'user not found' });
    }

    // Check if OTP exists and is not expired
    if (!existingUser.passwordResetOtp || !existingUser.passwordResetOtpExpiresAt) {
      return res.status(400).json({ message: 'OTP not requested or expired' });
    }

    if (existingUser.passwordResetOtp !== otp) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    if (existingUser.passwordResetOtpExpiresAt < new Date()) {
      return res.status(400).json({ message: 'OTP has expired' });
    }

    // OTP is valid, clear it and allow password reset
    existingUser.passwordResetOtp = null;
    existingUser.passwordResetOtpExpiresAt = null;
    await existingUser.save();

    res.json({ status: true, message: 'OTP verified successfully' });
  } catch (error) {
    return res.status(500).json({ message: 'failed to verify OTP', error: error.message });
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

exports.getDeviceNames = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: 'unauthorized' });
    }

    const buttons = await ButtonState.find({
      userId,
      type: 'USER',
    }).sort({ buttonName: 1 });

    const deviceNames = {};
    const deviceRooms = {};
    buttons.forEach(btn => {
      deviceNames[btn.buttonName] = btn.customName || getDefaultDeviceName(btn.buttonName);
      deviceRooms[btn.buttonName] = btn.customRoom || getDefaultDeviceRoom(btn.buttonName);
    });

    return res.json({ deviceNames, deviceRooms });
  } catch (error) {
    return res.status(500).json({ message: 'failed to fetch device names', error: error.message });
  }
};

exports.updateDeviceName = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { buttonName, customName, customRoom } = req.body;

    if (!userId) {
      return res.status(401).json({ message: 'unauthorized' });
    }

    if (!buttonName || (!customName && !customRoom)) {
      return res.status(400).json({ message: 'buttonName and at least one of customName or customRoom are required' });
    }

    const updateData = {};
    if (customName !== undefined) updateData.customName = customName.trim();
    if (customRoom !== undefined) updateData.customRoom = customRoom.trim();

    const updatedButton = await ButtonState.findOneAndUpdate(
      {
        buttonName,
        userId,
        type: 'USER',
      },
      updateData,
      { new: true }
    );

    if (!updatedButton) {
      return res.status(404).json({ message: 'button not found' });
    }

    return res.json({
      message: 'device name updated successfully',
      button: updatedButton,
    });
  } catch (error) {
    return res.status(500).json({ message: 'failed to update device name', error: error.message });
  }
};

function getDefaultDeviceName(buttonName) {
  const defaults = {
    'btn1': 'Room 1 Light',
    'btn2': 'Room 2 Light',
    'btn3': 'Dining Light',
    'btn4': 'Dining Fan'
  };
  return defaults[buttonName] || buttonName;
}

function getDefaultDeviceRoom(buttonName) {
  const defaults = {
    'btn1': 'Bedroom',
    'btn2': 'Bedroom 2',
    'btn3': 'Dining Room',
    'btn4': 'Dining Room'
  };
  return defaults[buttonName] || '';
}
