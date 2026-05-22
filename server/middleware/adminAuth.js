const jwt = require('jsonwebtoken');

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || 'dev-admin-secret-change-me';

const requireAdminAuth = (req, res, next) => {
    const authHeader = req.headers.authorization || '';

    if (!authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'กรุณาเข้าสู่ระบบผู้ดูแลระบบ' });
    }

    const token = authHeader.slice(7).trim();

    try {
        req.admin = jwt.verify(token, ADMIN_JWT_SECRET);
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Token ไม่ถูกต้องหรือหมดอายุ' });
    }
};

module.exports = {
    requireAdminAuth,
    ADMIN_JWT_SECRET
};
