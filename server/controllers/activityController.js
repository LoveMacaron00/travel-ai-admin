const pool = require('../config/db');
const { parsePositiveInteger } = require('./helpers/numberHelper');

// session id ต้องเป็นจำนวนเต็มบวกก่อนนำไปค้นหาหรืออัปเดตในฐานข้อมูล
const parseSessionId = parsePositiveInteger;

/**
 * รับ heartbeat จากแอปขณะอยู่ foreground
 * อัปเดต session เดิมที่เป็นของผู้ใช้ หรือสร้าง session ใหม่เมื่อไม่มี/ปิดไปแล้ว
 */
const heartbeat = async (req, res) => {
    try {
        const requestedSessionId = parseSessionId(req.body?.sessionId);
        let sessionId = null;

        if (requestedSessionId != null) {
            const { rows } = await pool.query(
                `UPDATE app_usage_sessions
                 SET last_seen_at = NOW()
                 WHERE id = $1 AND user_id = $2 AND ended_at IS NULL
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

/**
 * ปิด activity session เมื่อแอปออกจาก foreground หรือผู้ใช้ logout
 * จำกัดการปิดไว้เฉพาะ session ที่เป็นของผู้ใช้คนปัจจุบันและยังไม่ถูกปิด
 */
const endSession = async (req, res) => {
    try {
        const sessionId = parseSessionId(req.body?.sessionId);
        if (sessionId == null) {
            return res.status(400).json({ message: 'sessionId ไม่ถูกต้อง' });
        }

        await pool.query(
            `UPDATE app_usage_sessions
             SET last_seen_at = NOW(), ended_at = NOW()
             WHERE id = $1 AND user_id = $2 AND ended_at IS NULL`,
            [sessionId, req.user.id],
        );
        return res.status(204).send();
    } catch (error) {
        console.error('[activityController] end session error:', error);
        return res.status(500).json({ message: 'ไม่สามารถปิดช่วงเวลาการใช้งานได้' });
    }
};

module.exports = { heartbeat, endSession, parseSessionId };
