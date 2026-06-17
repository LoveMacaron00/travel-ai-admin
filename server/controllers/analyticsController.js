// Controller: Analytics (สถิติภาพรวม)
const AnalyticsModel = require('../models/analyticsModel');

/**
 * ดึงข้อมูลสถิติภาพรวมสำหรับแดชบอร์ด
 * GET /api/analytics/overview
 */
const getOverview = async (req, res) => {
    try {
        const totalDestinations = await AnalyticsModel.getTotalDestinations();
        const overview = {
            totalDestinations: totalDestinations,
            monthlyActiveUsers: 12450,
            peakUsageTime: '14:00 - 16:00',
            visits: 245000,
            visitGrowth: 15.3,
            topDestinations: [
                { name: 'Grand Palace', percent: 92, color: '#10B981' },
                { name: 'Phi Phi Islands', percent: 84, color: '#8B5CF6' },
                { name: 'Old City', percent: 76, color: '#3B82F6' },
                { name: 'Big Buddha', percent: 65, color: '#F59E0B' }
            ],
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