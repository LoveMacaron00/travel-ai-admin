const { config } = require('../config/env');
const { getAnalyticsRange } = require('../services/analyticsHelper');
const { parsePositiveInteger } = require('../utils/numberHelper');
const {
    getSummary,
    getPeakUsageTime,
    getTrendData,
    getTopDestinations,
    getDestinationTrendData,
    findApprovedDestinationById,
} = require('../repositories/analyticsRepository');

/** GET /api/analytics/destinations/:id/trend?range=24h|7d|30d|90d */
// ส่งแนวโน้มยอดดูของสถานที่ตาม id ให้ dashboard admin
const getDestinationTrend = async (req, res) => {
    try {
        const destinationId = parsePositiveInteger(req.params.id);
        if (destinationId == null) {
            return res.status(400).json({ message: 'รหัสสถานที่ไม่ถูกต้อง' });
        }

        const destination = await findApprovedDestinationById(destinationId);
        if (!destination) return res.status(404).json({ message: 'ไม่พบสถานที่' });

        const range = getAnalyticsRange(req.query.range);
        const timeZone = config.analytics.timeZone;
        const trendData = await getDestinationTrendData(range, timeZone, destinationId);
        return res.json({
            destination,
            period: range.key,
            periodLabel: range.label,
            timeZone,
            trendData,
        });
    } catch (error) {
        console.error('[analyticsController] destination trend error:', error);
        return res.status(500).json({ message: 'ไม่สามารถโหลดแนวโน้มสถานที่ได้' });
    }
};

/** GET /api/analytics/overview?range=24h|7d|30d|90d */
// ส่งข้อมูลภาพรวมทั้งหมดที่หน้า dashboard analytics ต้องใช้
const getOverview = async (req, res) => {
    try {
        const range = getAnalyticsRange(req.query.range);
        const timeZone = config.analytics.timeZone;
        const [summary, peakUsageTime, trendData, topDestinations] = await Promise.all([
            getSummary(range, timeZone),
            getPeakUsageTime(range, timeZone),
            getTrendData(range, timeZone),
            getTopDestinations(range),
        ]);

        res.json({
            period: range.key,
            periodLabel: range.label,
            timeZone,
            generatedAt: new Date().toISOString(),
            summary: { ...summary, peakUsageTime },
            trendData,
            topDestinations,
        });
    } catch (error) {
        console.error('[analyticsController] overview error:', error);
        res.status(500).json({ message: 'ไม่สามารถโหลดข้อมูลสถิติได้' });
    }
};

module.exports = {
    getOverview,
    getDestinationTrend,
};
