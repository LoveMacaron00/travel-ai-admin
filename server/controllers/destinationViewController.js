const pool = require('../config/db');
const { parsePositiveInteger } = require('./helpers/numberHelper');

const createRecordDestinationView = (database) => async (req, res) => {
    try {
        const destinationId = parsePositiveInteger(req.params.id);
        const sessionId = parsePositiveInteger(req.body?.sessionId);
        if (destinationId == null || sessionId == null) {
            return res.status(400).json({ message: 'destinationId หรือ sessionId ไม่ถูกต้อง' });
        }

        const { rows } = await database.query(
            `WITH valid_destination AS (
                SELECT id
                FROM destinations
                WHERE id = $1 AND status = 'approved'
            ), valid_session AS (
                SELECT id
                FROM app_usage_sessions
                WHERE id = $3 AND user_id = $2 AND ended_at IS NULL
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
            [destinationId, req.user.id, sessionId],
        );

        const result = rows[0];
        if (!result.destination_exists) {
            return res.status(404).json({ message: 'ไม่พบสถานที่' });
        }
        if (!result.session_exists) {
            return res.status(409).json({ message: 'activity session หมดอายุแล้ว' });
        }

        return res.status(result.recorded ? 201 : 200).json({
            recorded: result.recorded,
            duplicate: !result.recorded,
        });
    } catch (error) {
        console.error('[destinationViewController] record view error:', error);
        return res.status(500).json({ message: 'ไม่สามารถบันทึกยอดดูสถานที่ได้' });
    }
};

/**
 * บันทึกการเปิดหน้ารายละเอียดหนึ่งครั้งต่อสถานที่ต่อ activity session
 * unique constraint ในฐานข้อมูลเป็นตัวกันการกดเข้าออกหรือ retry ซ้ำ
 */
const recordDestinationView = createRecordDestinationView(pool);

module.exports = { createRecordDestinationView, recordDestinationView };
