// server/repositories/authRepository.js
// ชั้นเข้าถึงฐานข้อมูลของ admin auth — ย้าย SQL ออกจาก authController
const pool = require('../config/db');

// ค้นหาแอดมินด้วย email คืน { id, email, password } หรือ null
const findAdminByEmail = async (email, db = pool) => {
    const { rows } = await db.query(
        'SELECT id, email, password FROM admins WHERE email = $1 LIMIT 1',
        [email],
    );
    return rows[0] || null;
};

module.exports = { findAdminByEmail };
