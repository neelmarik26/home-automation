const jwt = require('jsonwebtoken');
const User = require('../models/userdataschem');

async function decodeJwtToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const tokenFromBearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  const token = tokenFromBearer || req.headers['x-access-token'];

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.token);
    const user = await User.findById(decoded.id).select('-password -passwordResetOtp -passwordResetOtpExpiresAt');

    if (!user) {
      return res.status(401).json({ message: 'user not found' });
    }

    if (user.status === 'BLOCKED') {
      return res.status(401).json({ message: 'user is blocked',logout:true });
    }

    req.user = {
      id: user._id,
      name: user.name,
      email: user.email,
      type: user.type,
      status: user.status,
    };
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

module.exports = decodeJwtToken;
