// server/controllers/authController.js

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { adminJwtSecret } = require('../config/jwtSecrets');

/**
 * เข้าสู่ระบบแอดมิน
 * POST /api/auth/login
 */
// ตรวจข้อมูลผู้ดูแลระบบและออก JWT สำหรับใช้งาน admin API
const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // ตรวจสอบว่ากรอกข้อมูลครบหรือไม่
        if (!email || !password) {
            return res.status(400).json({ message: 'กรุณากรอก Email และ Password' });
        }

        // ค้นหาแอดมินจากฐานข้อมูล
        const { rows } = await pool.query('SELECT id, email, password FROM admins WHERE email = $1 LIMIT 1', [email]);
        const admin = rows[0] || null;

        if (!admin) {
            return res.status(401).json({ message: 'Email หรือ Password ไม่ถูกต้อง' });
        }

        const isPasswordValid = await bcrypt.compare(password, admin.password);

        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Email หรือ Password ไม่ถูกต้อง' });
        }

        const token = jwt.sign(
            { id: admin.id, email: admin.email, role: 'admin' },
            adminJwtSecret,
            { expiresIn: '12h' }
        );

        res.json({
            message: 'เข้าสู่ระบบสำเร็จ',
            admin: { id: admin.id, email: admin.email },
            token
        });
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการเข้าสู่ระบบ:', err);
        res.status(500).json({ message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" });
    }
};

module.exports = {
    login
};
