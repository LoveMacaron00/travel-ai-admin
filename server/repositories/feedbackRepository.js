// server/repositories/feedbackRepository.js
// ชั้นเข้าถึงฐานข้อมูลของ feedback — ย้าย SQL ออกจาก feedbackController
const pool = require('../config/db');

// สร้าง feedback ใหม่ คืนแถวที่สร้าง
const createFeedback = async ({ userId, message }, db = pool) => {
    const { rows } = await db.query(
        `INSERT INTO feedback (user_id, message, status, created_at)
         VALUES ($1, $2, 'pending', NOW())
         RETURNING id, user_id, message, status, created_at`,
        [userId, message],
    );
    return rows[0];
};

// ดึง feedback ของผู้ใช้คนหนึ่ง เรียงใหม่สุดก่อน
const findByUserId = async (userId, db = pool) => {
    const { rows } = await db.query(
        `SELECT id, message, status, admin_reply, created_at
         FROM feedback
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId],
    );
    return rows;
};

// ดึง feedback ทั้งหมดพร้อมข้อมูลผู้ใช้สำหรับ admin
const findAllWithUsers = async (db = pool) => {
    const { rows } = await db.query(
        `SELECT f.id, f.message, f.status, f.admin_reply, f.created_at,
                u.username, u.email AS user_email
         FROM feedback f
         LEFT JOIN users u ON f.user_id = u.id
         ORDER BY f.created_at DESC`,
    );
    return rows;
};

// อัปเดตสถานะ/ข้อความตอบกลับ คืนแถวที่อัปเดตหรือ null ถ้าไม่พบ
const updateFeedback = async (id, { status, admin_reply }, db = pool) => {
    const { rows } = await db.query(
        `UPDATE feedback
         SET status = $1, admin_reply = $2
         WHERE id = $3
         RETURNING id, user_id, message, status, admin_reply, created_at`,
        [status, admin_reply, id],
    );
    return rows[0] || null;
};

module.exports = { createFeedback, findByUserId, findAllWithUsers, updateFeedback };
