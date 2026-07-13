// server/middleware/userAuth.js

const jwt = require('jsonwebtoken');
const NODE_ENV = process.env.NODE_ENV;
let USER_JWT_SECRET = process.env.USER_JWT_SECRET;

const WEAK_SECRETS = [
    'dev-user-secret',
    'change_this_user_secret_min_32_chars',
    'change_this_secret_min_32_chars',
    'secret',
    '123456'
];

if (!USER_JWT_SECRET) {
    if (NODE_ENV === 'production') {
        throw new Error('CRITICAL SECURITY ERROR: USER_JWT_SECRET is not configured in production environment.');
    } else {
        console.warn('[WARNING] USER_JWT_SECRET is not configured. Falling back to a weak dev secret. Do not use in production!');
        USER_JWT_SECRET = 'dev-user-secret-fallback-key-32chars-min-length-required';
    }
} else if (WEAK_SECRETS.includes(USER_JWT_SECRET.toLowerCase()) || USER_JWT_SECRET.length < 32) {
    if (NODE_ENV === 'production') {
        throw new Error('CRITICAL SECURITY ERROR: USER_JWT_SECRET is too weak or using default placeholder in production. It must be at least 32 characters.');
    } else {
        console.warn('[WARNING] USER_JWT_SECRET is too weak or using a default placeholder. Please set a strong secret (at least 32 characters) for production.');
    }
}

const requireUserAuth = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'กรุณาเข้าสู่ระบบ' });
    }
    try {
        req.user = jwt.verify(authHeader.slice(7).trim(), USER_JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({ message: 'Token ไม่ถูกต้องหรือหมดอายุ' });
    }
};

const optionalUserAuth = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
        try { req.user = jwt.verify(authHeader.slice(7).trim(), USER_JWT_SECRET); } catch { /* ignore */ }
    }
    next();
};

module.exports = { requireUserAuth, optionalUserAuth, USER_JWT_SECRET };
