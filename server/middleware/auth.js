// server/middleware/auth.js
// Unified auth middleware — previously duplicated in
// - middleware/adminAuth.js (requireAdminAuth)
// - middleware/userAuth.js (requireUserAuth)
// - middleware/secureUploads.js (re-implemented both + DB banned check)
// Now single verify function; old files delegate here to keep imports working (behavior identical).

const jwt = require('jsonwebtoken');
const { adminJwtSecret, userJwtSecret } = require('../config/jwtSecrets');
const pool = require('../config/db');

const extractBearer = (req) => {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
};

const requireAdminAuth = (req, res, next) => {
  const token = extractBearer(req);
  if (!token) return res.status(401).json({ message: 'กรุณาเข้าสู่ระบบผู้ดูแลระบบ' });
  try {
    req.admin = jwt.verify(token, adminJwtSecret);
    return next();
  } catch {
    return res.status(401).json({ message: 'Token ไม่ถูกต้องหรือหมดอายุ' });
  }
};

const requireUserAuth = (req, res, next) => {
  const token = extractBearer(req);
  if (!token) return res.status(401).json({ message: 'กรุณาเข้าสู่ระบบ' });
  try {
    req.user = jwt.verify(token, userJwtSecret);
    return next();
  } catch {
    return res.status(401).json({ message: 'Token ไม่ถูกต้องหรือหมดอายุ' });
  }
};

// For secureUploads: same logic as before but now reusing extractBearer and secrets.
const verifyUploadToken = async (token) => {
  if (!token) return null;
  try {
    const admin = jwt.verify(token, adminJwtSecret);
    if (admin) return { type: 'admin', payload: admin };
  } catch {}
  try {
    const user = jwt.verify(token, userJwtSecret);
    if (user && user.id) {
      const { rows } = await pool.query('SELECT id, is_banned FROM users WHERE id = $1', [user.id]);
      const dbUser = rows[0];
      if (!dbUser) return { type: 'invalid' };
      if (dbUser.is_banned) return { type: 'banned' };
      return { type: 'user', payload: user };
    }
  } catch {}
  return null;
};

module.exports = { requireAdminAuth, requireUserAuth, extractBearer, verifyUploadToken };
