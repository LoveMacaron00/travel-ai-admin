const pool = require('../config/db');
const { recordView } = require('../repositories/destinationViewRepository');
const { parsePositiveInteger } = require('../utils/numberHelper');

// สร้าง handler บันทึกการเปิดดูสถานที่หนึ่งครั้งต่อ activity session
const createRecordDestinationView = (database) => async (req, res) => {
    try {
        const destinationId = parsePositiveInteger(req.params.id);
        const sessionId = parsePositiveInteger(req.body?.sessionId);
        if (destinationId == null || sessionId == null) {
            return res.status(400).json({ message: 'destinationId หรือ sessionId ไม่ถูกต้อง' });
        }

        const result = await recordView(
            { destinationId, userId: req.user.id, sessionId },
            database,
        );
        if (!result.destination_exists) {
            return res.status(404).json({ message: 'ไม่พบสถานที่' });
        }
        if (!result.session_exists) {
            return res.status(409).json({ message: 'ไม่พบ activity session' });
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

module.exports = { recordDestinationView };
