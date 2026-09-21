// server/repositories/userRepository.js
// ชั้นเข้าถึงฐานข้อมูลของผู้ใช้ — ย้าย SQL ออกจาก userController
const pool = require('../config/db');

const PUBLIC_COLUMNS = 'id, email, username, profile_image_url, interests, is_banned, created_at';

// รายชื่อผู้ใช้ทั้งหมดสำหรับ admin ใหม่สุดก่อน
const findAll = async (db = pool) => {
    const { rows } = await db.query(
        `SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY created_at DESC`,
    );
    return rows;
};

// ค้นหาผู้ใช้ด้วย email (คอลัมน์สาธารณะ) คืนแถวหรือ null
const findByEmail = async (email, db = pool) => {
    const { rows } = await db.query(
        `SELECT ${PUBLIC_COLUMNS} FROM users WHERE email = $1`,
        [email],
    );
    return rows[0] || null;
};

// ค้นหาผู้ใช้ด้วย email พร้อมรหัสผ่าน (สำหรับ login เท่านั้น)
const findByEmailWithPassword = async (email, db = pool) => {
    const { rows } = await db.query(
        `SELECT ${PUBLIC_COLUMNS}, hash_password FROM users WHERE email = $1`,
        [email],
    );
    return rows[0] || null;
};

// สร้างผู้ใช้ใหม่ คืนแถวที่สร้าง
const createUser = async ({ email, passwordHash }, db = pool) => {
    const { rows } = await db.query(
        `INSERT INTO users (email, hash_password, username)
         VALUES ($1, $2, $3)
         RETURNING ${PUBLIC_COLUMNS}`,
        [email, passwordHash, null],
    );
    return rows[0];
};

// อ่านสถานะแบน คืน true/false หรือ null ถ้าไม่พบผู้ใช้
const findBanStatus = async (userId, db = pool) => {
    const { rows } = await db.query(
        'SELECT is_banned FROM users WHERE id = $1',
        [userId],
    );
    if (rows.length === 0) return null;
    return rows[0].is_banned;
};

// ตั้งสถานะแบน คืนแถวที่อัปเดตหรือ null ถ้าไม่พบ
const setBanStatus = async (userId, isBanned, db = pool) => {
    const { rows } = await db.query(
        `UPDATE users SET is_banned = $1 WHERE id = $2
         RETURNING ${PUBLIC_COLUMNS}`,
        [isBanned, userId],
    );
    return rows[0] || null;
};

// อัปเดตโปรไฟล์แบบบางส่วน (เฉพาะฟิลด์ที่ส่งมา) คืนแถวที่อัปเดตหรือ null
const updateProfile = async (userId, { username, interests, profile_image_url }, db = pool) => {
    const updateStrings = [];
    const values = [];
    let index = 1;

    if (username !== undefined) {
        updateStrings.push(`username = $${index++}`);
        values.push(username);
    }
    if (interests !== undefined) {
        updateStrings.push(`interests = $${index++}`);
        values.push(JSON.stringify(Array.isArray(interests) ? interests : []));
    }
    if (profile_image_url !== undefined) {
        updateStrings.push(`profile_image_url = $${index++}`);
        values.push(profile_image_url);
    }

    if (updateStrings.length === 0) return null;

    values.push(userId);
    const { rows } = await db.query(
        `UPDATE users
         SET ${updateStrings.join(', ')}
         WHERE id = $${index}
         RETURNING ${PUBLIC_COLUMNS}`,
        values,
    );
    return rows[0] || null;
};

// อัปเดต URL รูปโปรไฟล์ คืนแถวที่อัปเดตหรือ null
const updateProfileImage = async (userId, imageUrl, db = pool) => {
    const { rows } = await db.query(
        `UPDATE users SET profile_image_url = $1 WHERE id = $2 RETURNING ${PUBLIC_COLUMNS}`,
        [imageUrl, userId],
    );
    return rows[0] || null;
};

module.exports = {
    PUBLIC_COLUMNS,
    findAll,
    findByEmail,
    findByEmailWithPassword,
    createUser,
    findBanStatus,
    setBanStatus,
    updateProfile,
    updateProfileImage,
};
