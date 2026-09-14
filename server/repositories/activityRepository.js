// server/repositories/activityRepository.js
// ชั้นเข้าถึงฐานข้อมูลของ activity sessions — ย้าย SQL ออกจาก activityController
// รับ db เสริมได้ (pool หรือ transaction client) เพื่อให้ reuse และทดสอบได้
const pool = require('../config/db');

// อัปเดต heartbeat ของ session เดิมที่เป็นของผู้ใช้ คืน id หรือ null ถ้าไม่พบ
const touchSession = async (sessionId, userId, db = pool) => {
    const { rows } = await db.query(
        `UPDATE app_usage_sessions
         SET last_seen_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING id`,
        [sessionId, userId],
    );
    return rows[0]?.id ?? null;
};

// สร้าง session ใหม่ให้ผู้ใช้ คืน id
const createSession = async (userId, db = pool) => {
    const { rows } = await db.query(
        `INSERT INTO app_usage_sessions (user_id)
         VALUES ($1)
         RETURNING id`,
        [userId],
    );
    return rows[0].id;
};

module.exports = { touchSession, createSession };
