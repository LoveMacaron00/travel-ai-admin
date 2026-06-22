const tatPopularService = require('../services/tatPopularService');

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

module.exports = {
    getPopularDestinations
};
