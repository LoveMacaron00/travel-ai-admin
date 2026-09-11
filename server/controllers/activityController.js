const { touchSession, createSession } = require('../repositories/activityRepository');
const { parsePositiveInteger } = require('../utils/numberHelper');

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
            sessionId = await touchSession(requestedSessionId, req.user.id);
        }

        if (sessionId == null) {
            sessionId = await createSession(req.user.id);
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
