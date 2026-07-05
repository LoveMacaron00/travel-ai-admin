// Controller: Analytics (สถิติภาพรวม)
const pool = require('../config/db');

const TAT_API_BASE = 'https://tatdataapi.io/api/v2';

const getFirstImage = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.find(Boolean) || '';
    return '';
};

const toNumber = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
};

const normalizePlace = (place) => {
    const province = place.location?.province?.name || '';
    const district = place.location?.district?.name || '';
    const image =
        getFirstImage(place.thumbnailUrl) ||
        place.sha?.detailThumbnail ||
        place.sha?.thumbnailUrl ||
        '';

    return {
        id: place.placeId || place.id || '',
        name: place.name || 'Unknown',
        city: province || district || 'Thailand',
        location: [district, province].filter(Boolean).join(', ') || place.category?.name || 'Thailand',
        image,
        viewer: toNumber(place.viewer),
        category: place.category?.name || '',
        introduction: place.introduction || place.sha?.detail || ''
    };
};

const getTatApiKey = () => {
    const apiKey = process.env.TATDATAAPI;
    if (!apiKey || apiKey === 'your_tat_api_key_here') {
        const err = new Error('ไม่ได้ตั้งค่า TAT API Key ในระบบ (.env)');
        err.statusCode = 503;
        throw err;
    }
    return apiKey;
};

const getDestinations = async ({ limit = 5 } = {}) => {
    const apiKey = getTatApiKey();

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 20);
    const params = new URLSearchParams({
        numberOfResult: '30',
        page: '1'
    });

    const response = await fetch(`${TAT_API_BASE}/places?${params}`, {
        headers: {
            'x-api-key': apiKey,
            'Accept-Language': 'th'
        }
    });

    if (!response.ok) {
        const err = new Error(`TAT API request failed with status ${response.status}`);
        err.statusCode = response.status;
        throw err;
    }

    const payload = await response.json();
    const places = Array.isArray(payload?.data) ? payload.data : [];

    return places
        .map(normalizePlace)
        .filter((place) => place.id && place.image)
        .sort((a, b) => b.viewer - a.viewer)
        .slice(0, safeLimit);
};

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
        const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM destinations');
        const totalDestinations = rows[0].total;
        let topDestinations = [];

        try {
            topDestinations = withRankStats(await getDestinations({ limit: 5 }));
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
