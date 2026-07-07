function requireAdmin(req, res, next) {
  if (!req.user || req.user.type !== 'ADMIN') {
    return res.status(403).json({ message: 'admin access required' });
  }
  next();
}

module.exports = requireAdmin;
