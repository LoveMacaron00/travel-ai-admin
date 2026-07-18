const pool = require('../config/db');
const { parsePositiveInteger } = require('./helpers/numberHelper');

const parseSessionId = parsePositiveInteger;

/**
 * ต่ออายุ activity session ทุกหนึ่งนาทีขณะที่แอปอยู่ foreground
 * ถ้า session เดิมจบไปแล้วหรือไม่ใช่ของผู้ใช้ จะสร้าง session ใหม่ให้เอง
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

/** ปิด session เมื่อแอปออกจาก foreground หรือผู้ใช้ logout */
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
