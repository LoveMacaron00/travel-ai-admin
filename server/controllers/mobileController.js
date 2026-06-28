const tatPopularService = require('../services/tatPopularService');
const { mobileRagChat } = require('../services/aiService');

/**
 * ดึงสถานที่ยอดนิยมจาก TAT API สำหรับ mobile app
 * GET /api/mobile/popular-destinations
 */
const getPopularDestinations = async (req, res) => {
    try {
        const data = await tatPopularService.getPopularDestinations({
            limit: req.query.limit || 3
        });
        res.json({ data });
    } catch (err) {
        console.error('[mobileController] popular-destinations error:', err);
        res.status(err.statusCode || 500).json({
            message: err.statusCode === 503
                ? err.message
                : 'เกิดข้อผิดพลาดในการดึงข้อมูลสถานที่ยอดนิยม'
        });
    }
};

const chatWithAssistant = async (req, res) => {
    try {
        const { message, province } = req.body;
        if (!message?.trim()) {
            return res.status(400).json({ message: 'กรุณาระบุข้อความ' });
        }

        const data = await mobileRagChat(message.trim(), {
            province: province || null,
            limit: 5,
        });

        res.json(data);
    } catch (err) {
        console.error('[mobileController] chat error:', err);
        res.status(500).json({
            message: 'เกิดข้อผิดพลาดในการตอบคำถามท่องเที่ยว'
        });
    }
};

module.exports = {
    getPopularDestinations,
    chatWithAssistant
};
