const bcrypt = require('bcrypt');

const User = require('../models/userdataschem');
const ButtonState = require('../models/LAST5BUTTON');

function isAdmin(req, res) {
  if (req.user?.type !== 'ADMIN') {
    res.status(403).json({ message: 'admin access required' });
    return false;
  }
  return true;
}

exports.listUsers = async (req, res) => {
  try {
    if (!isAdmin(req, res)) return;

    const users = await User.find({ deletedAt: null }).select('-password -passwordResetOtp -passwordResetOtpExpiresAt');
    return res.json({ users });
  } catch (error) {
    return res.status(500).json({ message: 'failed to fetch users', error: error.message });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    if (!isAdmin(req, res)) return;

    const userId = req.params.id || req.body.userId;
    if (!userId) {
      return res.status(400).json({ message: 'user id is required' });
    }

    const deletedUser = await User.findOneAndUpdate(
      { _id: userId, deletedAt: null },
      { deletedAt: new Date() },
      { new: true }
    ).select('-password -passwordResetOtp -passwordResetOtpExpiresAt');

    if (!deletedUser) {
      return res.status(404).json({ message: 'user not found' });
    }

    return res.json({
      message: 'user deleted successfully',
      user: {
        id: deletedUser._id,
        name: deletedUser.name,
        email: deletedUser.email,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'failed to delete user', error: error.message });
  }
};

exports.addAdmin = async (req, res) => {
  try {
    if (!isAdmin(req, res)) return;

    const { email, username, password } = req.body;

    if (!email || !username || !password) {
      return res.status(400).json({ message: 'email, username, and password are required' });
    }

    const existingUser = await User.findOne({ email, deletedAt: null });
    if (existingUser) {
      return res.status(409).json({ message: 'user is already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const adminUser = await User.create({
      name: username,
      email,
      password: hashedPassword,
      type: 'ADMIN',
      status: 'ACTIVE',
    });

    return res.status(201).json({
      message: 'admin added successfully',
      user: {
        id: adminUser._id,
        name: adminUser.name,
        email: adminUser.email,
        type: adminUser.type,
        status: adminUser.status,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'user is already registered' });
    }
    return res.status(500).json({ message: 'failed to add admin', error: error.message });
  }
};

exports.blockUser = async (req, res) => {
  try {
    if (!isAdmin(req, res)) return;

    const userId = req.params.id || req.body.userId;
    if (!userId) {
      return res.status(400).json({ message: 'user id is required' });
    }

    const updatedUser = await User.findOneAndUpdate(
      { _id: userId, deletedAt: null },
      { status: 'BLOCKED' },
      { new: true }
    ).select('-password -passwordResetOtp -passwordResetOtpExpiresAt');

    if (!updatedUser) {
      return res.status(404).json({ message: 'user not found' });
    }

    return res.json({
      message: 'user blocked successfully',
      user: updatedUser,
    });
  } catch (error) {
    return res.status(500).json({ message: 'failed to block user', error: error.message });
  }
};

exports.unblockUser = async (req, res) => {
  try {
    if (!isAdmin(req, res)) return;

    const userId = req.params.id || req.body.userId;
    if (!userId) {
      return res.status(400).json({ message: 'user id is required' });
    }

    const updatedUser = await User.findOneAndUpdate(
      { _id: userId, deletedAt: null },
      { status: 'ACTIVE' },
      { new: true }
    ).select('-password -passwordResetOtp -passwordResetOtpExpiresAt');

    if (!updatedUser) {
      return res.status(404).json({ message: 'user not found' });
    }

    return res.json({
      message: 'user unblocked successfully',
      user: updatedUser,
    });
  } catch (error) {
    return res.status(500).json({ message: 'failed to unblock user', error: error.message });
  }
};

exports.makeFirstAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'email and password are required' });
    }

    const existingAdmin = await User.findOne({ type: 'ADMIN', deletedAt: null });
    if (existingAdmin) {
      return res.status(403).json({ message: 'an admin already exists' });
    }

    const existingUser = await User.findOne({ email, deletedAt: null });
    if (!existingUser) {
      return res.status(404).json({ message: 'user not found' });
    }

    const passwordMatch = await bcrypt.compare(password, existingUser.password);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'invalid credentials' });
    }

    existingUser.type = 'ADMIN';
    await existingUser.save();

    return res.json({
      message: 'user is now an admin',
      user: {
        id: existingUser._id,
        name: existingUser.name,
        email: existingUser.email,
        type: existingUser.type,
        status: existingUser.status,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'failed to make first admin', error: error.message });
  }
};

exports.promoteToAdmin = async (req, res) => {
  try {
    if (!isAdmin(req, res)) return;

    const userId = req.params.id || req.body.userId;
    if (!userId) {
      return res.status(400).json({ message: 'user id is required' });
    }

    const updatedUser = await User.findOneAndUpdate(
      { _id: userId, deletedAt: null },
      { type: 'ADMIN' },
      { new: true }
    ).select('-password -passwordResetOtp -passwordResetOtpExpiresAt');

    if (!updatedUser) {
      return res.status(404).json({ message: 'user not found' });
    }

    return res.json({
      message: 'user promoted to admin',
      user: updatedUser,
    });
  } catch (error) {
    return res.status(500).json({ message: 'failed to promote user', error: error.message });
  }
};

exports.removeAdmin = async (req, res) => {
  try {
    if (!isAdmin(req, res)) return;

    const userId = req.params.id || req.body.userId;
    if (!userId) {
      return res.status(400).json({ message: 'user id is required' });
    }

    const updatedUser = await User.findOneAndUpdate(
      { _id: userId, deletedAt: null },
      { type: 'USER' },
      { new: true }
    ).select('-password -passwordResetOtp -passwordResetOtpExpiresAt');

    if (!updatedUser) {
      return res.status(404).json({ message: 'user not found' });
    }

    return res.json({
      message: 'user demoted to user',
      user: updatedUser,
    });
  } catch (error) {
    return res.status(500).json({ message: 'failed to remove admin', error: error.message });
  }
};
