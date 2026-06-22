// Controller: Analytics (สถิติภาพรวม)
const AnalyticsModel = require('../models/analyticsModel');
const { getPopularDestinations } = require('../services/tatPopularService');

const destinationColors = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6'];

const withRankStats = (destinations) => {
    const maxViewer = Math.max(...destinations.map((destination) => destination.viewer), 1);

    return destinations.map((destination, index) => ({
        ...destination,
        percent: Math.max(1, Math.round((destination.viewer / maxViewer) * 100)),
        color: destinationColors[index % destinationColors.length]
    }));
};

/**
 * ดึงข้อมูลสถิติภาพรวมสำหรับแดชบอร์ด
 * GET /api/analytics/overview
 */
const getOverview = async (req, res) => {
    try {
        const totalDestinations = await AnalyticsModel.getTotalDestinations();
        let topDestinations = [];

        try {
            topDestinations = withRankStats(await getPopularDestinations({ limit: 5 }));
        } catch (err) {
            console.error('[analyticsController] top destinations error:', err.message);
        }

        const overview = {
            totalDestinations: totalDestinations,
            monthlyActiveUsers: 12450,
            peakUsageTime: '14:00 - 16:00',
            visits: 245000,
            visitGrowth: 15.3,
            topDestinations,
            trafficData: [
                { date: 'Jan 01', value: 120 },
                { date: 'Jan 05', value: 150 },
                { date: 'Jan 10', value: 180 },
                { date: 'Jan 15', value: 220 },
                { date: 'Jan 20', value: 260 },
                { date: 'Jan 25', value: 310 },
                { date: 'Jan 30', value: 380 }
            ]
        };
        res.json(overview);
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการดึงข้อมูลสถิติ:', err);
        res.status(500).json({ message: "เกิดข้อผิดพลาดภายใน analyticsController - getOverview" });
    }
};

module.exports = {
    getOverview
};
