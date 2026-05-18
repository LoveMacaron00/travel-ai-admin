// Controller: Auth (การยืนยันตัวตน)
// จัดการ logic การเข้าสู่ระบบของแอดมิน

const { query } = require('../db');

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
        const { rows } = await query(
            'SELECT id, email FROM admins WHERE email = $1 AND password = $2 LIMIT 1',
            [email, password]
        );
        const admin = rows[0] || null;

        if (!admin) {
            return res.status(401).json({ message: 'Email หรือ Password ไม่ถูกต้อง' });
        }

        res.json({ message: 'เข้าสู่ระบบสำเร็จ', admin });
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการเข้าสู่ระบบ:', err);
        res.status(500).json({ message: "เกิดข้อผิดพลาดภายใน authController - login" });
    }
};

module.exports = {
    login
};
