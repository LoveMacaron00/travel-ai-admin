// server/middleware/userAuth.js

const jwt = require('jsonwebtoken');
const { userJwtSecret } = require('../config/jwtSecrets');

const requireUserAuth = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'กรุณาเข้าสู่ระบบ' });
    }
    try {
        req.user = jwt.verify(authHeader.slice(7).trim(), userJwtSecret);
        next();
    } catch {
        return res.status(401).json({ message: 'Token ไม่ถูกต้องหรือหมดอายุ' });
    }
};

const optionalUserAuth = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
        try {
            req.user = jwt.verify(authHeader.slice(7).trim(), userJwtSecret);
        } catch {
            // endpoint แบบ optional auth ทำงานต่อในฐานะ guest เมื่อ token ใช้ไม่ได้
        }
    }
    next();
};

module.exports = { requireUserAuth, optionalUserAuth };
