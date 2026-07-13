// server/middleware/adminAuth.js

const jwt = require('jsonwebtoken');
const NODE_ENV = process.env.NODE_ENV;
let ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;

const WEAK_SECRETS = [
    'dev-admin-secret',
    'change_this_admin_secret_min_32_chars',
    'change_this_secret_min_32_chars',
    'secret',
    '123456'
];

if (!ADMIN_JWT_SECRET) {
    if (NODE_ENV === 'production') {
        throw new Error('CRITICAL SECURITY ERROR: ADMIN_JWT_SECRET is not configured in production environment.');
    } else {
        console.warn('[WARNING] ADMIN_JWT_SECRET is not configured. Falling back to a weak dev secret. Do not use in production!');
        ADMIN_JWT_SECRET = 'dev-admin-secret-fallback-key-32chars-min-length-required';
    }
} else if (WEAK_SECRETS.includes(ADMIN_JWT_SECRET.toLowerCase()) || ADMIN_JWT_SECRET.length < 32) {
    if (NODE_ENV === 'production') {
        throw new Error('CRITICAL SECURITY ERROR: ADMIN_JWT_SECRET is too weak or using default placeholder in production. It must be at least 32 characters.');
    } else {
        console.warn('[WARNING] ADMIN_JWT_SECRET is too weak or using a default placeholder. Please set a strong secret (at least 32 characters) for production.');
    }
}

const requireAdminAuth = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'กรุณาเข้าสู่ระบบผู้ดูแลระบบ' });
    }
    try {
        req.admin = jwt.verify(authHeader.slice(7).trim(), ADMIN_JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({ message: 'Token ไม่ถูกต้องหรือหมดอายุ' });
    }
};

module.exports = { requireAdminAuth, ADMIN_JWT_SECRET };
