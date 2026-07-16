// server/middleware/secureUploads.js

const jwt = require('jsonwebtoken');
const { adminJwtSecret, userJwtSecret } = require('../config/jwtSecrets');
const pool = require('../config/db');

const secureUploads = async (req, res, next) => {
    // รับ token จาก header เท่านั้น ป้องกัน JWT ติด browser history, referrer
    // และ access log จาก query string
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : null;

    if (!token) {
        return res.status(401).json({ message: 'จำเป็นต้องเข้าสู่ระบบเพื่อเข้าถึงไฟล์นี้' });
    }

    try {
        // Token สองประเภทใช้ secret คนละชุด จึงลอง admin ก่อนแล้วค่อย user
        try {
            const adminDecoded = jwt.verify(token, adminJwtSecret);
            if (adminDecoded) {
                return next();
            }
        } catch (err) {
            // ไม่ใช่แอดมิน ลองตรวจสอบผู้ใช้ทั่วไปต่อ
        }

        const userDecoded = jwt.verify(token, userJwtSecret);
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
