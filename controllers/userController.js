const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const User = require('../models/userdataschem');
const ButtonState = require('../models/LAST5BUTTON');
const { sendOtpEmail } = require('../helpers/emailhelper');

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
    return res.status(500).json({ message: 'error occurred while logging in', error: error.message });
  }
};

exports.sendForgotPasswordOtp = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'email is required' });
    }

    const existingUser = await User.findOne({ email });
    if (!existingUser) {
      return res.status(404).json({ message: 'user not found' });
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    existingUser.passwordResetOtp = otp;
    existingUser.passwordResetOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await existingUser.save();

    await sendOtpEmail(email, otp);

    return res.json({ message: 'otp sent to email' });
  } catch (error) {
    return res.status(500).json({ message: 'failed to send otp', error: error.message });
  }
};

exports.verifyOtpAndResetPassword = async (req, res) => {
  try {
    const { email, otp, password, newpassword } = req.body;
    const nextPassword = password || newpassword;

    if (!email || !otp || !nextPassword) {
      return res.status(400).json({ message: 'email, otp, and new password are required' });
    }

    if (!isStrongPassword(nextPassword)) {
      return res.status(400).json({
        message: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
      });
    }

    const existingUser = await User.findOne({ email });
    if (!existingUser) {
      return res.status(404).json({ message: 'user not found' });
    }

    if (!existingUser.passwordResetOtp || !existingUser.passwordResetOtpExpiresAt) {
      return res.status(400).json({ message: 'otp not found or expired' });
    }

    if (existingUser.passwordResetOtpExpiresAt.getTime() < Date.now()) {
      existingUser.passwordResetOtp = null;
      existingUser.passwordResetOtpExpiresAt = null;
      await existingUser.save();
      return res.status(400).json({ message: 'otp expired' });
    }

    if (existingUser.passwordResetOtp !== String(otp)) {
      return res.status(400).json({ message: 'invalid otp' });
    }

    const hashedPassword = await bcrypt.hash(nextPassword, 10);
    existingUser.password = hashedPassword;
    existingUser.passwordResetOtp = null;
    existingUser.passwordResetOtpExpiresAt = null;
    await existingUser.save();

    return res.json({ message: 'Password updated successfully' });
  } catch (error) {
    return res.status(500).json({ message: 'failed to reset password', error: error.message });
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
      }
    );

    if (!updatedButton) {
      return res.status(404).json({ message: 'button not found' });
    }

    return res.json({
      message: 'button status updated successfully',
      button: updatedButton,
    });
  } catch (error) {
    return res.status(500).json({ message: 'failed to update button status', error: error.message });
  }
};
