// Controller: Auth (การยืนยันตัวตน)
// จัดการ logic การเข้าสู่ระบบของแอดมิน

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { ADMIN_JWT_SECRET } = require('../middleware/adminAuth');

const isBcryptHash = (value) => typeof value === 'string' && /^\$2[aby]\$\d{2}\$/.test(value);

/**
 * เข้าสู่ระบบแอดมิน
 * POST /api/auth/login
 */
const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // ตรวจสอบว่ากรอกข้อมูลครบหรือไม่
        if (!email || !password) {
            return res.status(400).json({ message: 'กรุณากรอก Email และ Password' });
        }

        // ค้นหาแอดมินจากฐานข้อมูล
        const { rows } = await query('SELECT id, email, password FROM admins WHERE email = $1 LIMIT 1', [email]);
        const admin = rows[0] || null;

        if (!admin) {
            return res.status(401).json({ message: 'Email หรือ Password ไม่ถูกต้อง' });
        }

        let isPasswordValid = false;

        if (isBcryptHash(admin.password)) {
            isPasswordValid = await bcrypt.compare(password, admin.password);
        } else {
            isPasswordValid = admin.password === password;

            if (isPasswordValid) {
                const passwordHash = await bcrypt.hash(password, 10);
                await query('UPDATE admins SET password = $1 WHERE id = $2', [passwordHash, admin.id]);
            }
        }

        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Email หรือ Password ไม่ถูกต้อง' });
        }

        const token = jwt.sign(
            { id: admin.id, email: admin.email, role: 'admin' },
            ADMIN_JWT_SECRET,
            { expiresIn: '12h' }
        );

        res.json({
            message: 'เข้าสู่ระบบสำเร็จ',
            admin: { id: admin.id, email: admin.email },
            token
        });
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการเข้าสู่ระบบ:', err);
        res.status(500).json({ message: "เกิดข้อผิดพลาดภายใน authController - login" });
    }
};

module.exports = {
    login
};
