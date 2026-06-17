const jwt = require('jsonwebtoken');
const USER_JWT_SECRET = process.env.USER_JWT_SECRET;

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
