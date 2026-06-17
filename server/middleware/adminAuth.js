const jwt = require('jsonwebtoken');
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;

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
