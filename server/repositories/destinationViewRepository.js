// server/repositories/destinationViewRepository.js
// ชั้นเข้าถึงฐานข้อมูลของการบันทึกยอดดูสถานที่ — ย้าย SQL ออกจาก destinationViewController
const pool = require('../config/db');

// บันทึกการเปิดดูหนึ่งครั้งต่อ activity session (unique constraint กันซ้ำ)
// คืน { destination_exists, session_exists, recorded }
const recordView = async ({ destinationId, userId, sessionId }, db = pool) => {
    const { rows } = await db.query(
        `WITH valid_destination AS (
            SELECT id
            FROM destinations
            WHERE id = $1 AND status = 'approved'
        ), valid_session AS (
            SELECT id
            FROM app_usage_sessions
            WHERE id = $3 AND user_id = $2
        ), inserted AS (
            INSERT INTO destination_view_events (
                destination_id,
                user_id,
                usage_session_id
            )
            SELECT destination.id, $2, session.id
            FROM valid_destination destination
            CROSS JOIN valid_session session
            ON CONFLICT (usage_session_id, destination_id) DO NOTHING
            RETURNING id
        )
        SELECT
            EXISTS(SELECT 1 FROM valid_destination) AS destination_exists,
            EXISTS(SELECT 1 FROM valid_session) AS session_exists,
            EXISTS(SELECT 1 FROM inserted) AS recorded`,
        [destinationId, userId, sessionId],
    );
    return rows[0];
};

module.exports = { recordView };
