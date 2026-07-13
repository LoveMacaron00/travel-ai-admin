// server/middleware/secureUploads.js

const jwt = require('jsonwebtoken');
const { ADMIN_JWT_SECRET } = require('./adminAuth');
const { USER_JWT_SECRET } = require('./userAuth');
const pool = require('../config/db');

const secureUploads = async (req, res, next) => {
    let token = req.query.token;
    if (!token) {
        const authHeader = req.headers.authorization || '';
        if (authHeader.startsWith('Bearer ')) {
            token = authHeader.slice(7).trim();
        }
    }

    if (!token) {
        return res.status(401).json({ message: 'จำเป็นต้องเข้าสู่ระบบเพื่อเข้าถึงไฟล์นี้' });
    }

    try {
        // 1. ตรวจสอบสิทธิ์ของแอดมินก่อน
        try {
            const adminDecoded = jwt.verify(token, ADMIN_JWT_SECRET);
            if (adminDecoded) {
                return next();
            }
        } catch (err) {
            // ไม่ใช่แอดมิน ลองตรวจสอบผู้ใช้ทั่วไปต่อ
        }

        // 2. ตรวจสอบสิทธิ์ของผู้ใช้ทั่วไป
        const userDecoded = jwt.verify(token, USER_JWT_SECRET);
        if (userDecoded && userDecoded.id) {
            const { rows } = await pool.query('SELECT id, is_banned FROM users WHERE id = $1', [userDecoded.id]);
            const user = rows[0] || null;
            
            if (!user) {
                return res.status(401).json({ message: 'ไม่พบข้อมูลผู้ใช้ในระบบ' });
            }
            if (user.is_banned) {
                return res.status(403).json({ message: 'บัญชีนี้ถูกระงับการใช้งาน' });
            }
            return next();
        }

        return res.status(401).json({ message: 'Token ไม่ถูกต้อง' });
    } catch (err) {
        return res.status(401).json({ message: 'การยืนยันตัวตนล้มเหลวหรือ Token หมดอายุ' });
    }
};

module.exports = { secureUploads };
