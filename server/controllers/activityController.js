const pool = require('../config/db');
const { parsePositiveInteger } = require('./helpers/numberHelper');

// session id ต้องเป็นจำนวนเต็มบวกก่อนนำไปค้นหาหรืออัปเดตในฐานข้อมูล
const parseSessionId = parsePositiveInteger;

/**
 * รับ heartbeat จากแอปขณะอยู่ foreground
 * อัปเดต session เดิมที่เป็นของผู้ใช้ หรือสร้าง session ใหม่เมื่อไม่พบ session เดิม
 * ความ active ดูจาก last_seen_at อย่างเดียว (ไม่มี ended_at แล้ว):
 * แอปเข้า background แค่หยุดส่ง heartbeat แล้ว session จะหมดอายุเอง
 */
const heartbeat = async (req, res) => {
    try {
        const requestedSessionId = parseSessionId(req.body?.sessionId);
        let sessionId = null;

        if (requestedSessionId != null) {
            const { rows } = await pool.query(
                `UPDATE app_usage_sessions
                 SET last_seen_at = NOW()
                 WHERE id = $1 AND user_id = $2
                 RETURNING id`,
                [requestedSessionId, req.user.id],
            );
            sessionId = rows[0]?.id ?? null;
        }

        if (sessionId == null) {
            const { rows } = await pool.query(
                `INSERT INTO app_usage_sessions (user_id)
                 VALUES ($1)
                 RETURNING id`,
                [req.user.id],
            );
            sessionId = rows[0].id;
        }

        res.status(200).json({
            sessionId: Number(sessionId),
            serverTime: new Date().toISOString(),
        });
    } catch (error) {
        console.error('[activityController] heartbeat error:', error);
        res.status(500).json({ message: 'ไม่สามารถบันทึกสถานะการใช้งานได้' });
    }
};

module.exports = { heartbeat };
