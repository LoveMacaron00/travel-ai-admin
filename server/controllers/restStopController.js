// server/controllers/restStopController.js
// GET /api/mobile/rest-stops — ค้นจุดแวะพัก OSM รอบพิกัด (ไม่ต้อง login)

const { searchRestStops, REST_STOP_ATTRIBUTION, REST_STOP_FILTERS } = require('../services/restStopService');

const finiteCoord = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

// GET /api/mobile/rest-stops?lat=..&lon=..&radius=..&type=..&limit=..
// type รับได้หลายค่าคั่น comma (ดู REST_STOP_FILTERS) — ไม่ส่งมา = ร้านสะดวกซื้อ/ปั๊ม/คาเฟ่
const getRestStops = async (req, res) => {
    const lat = finiteCoord(req.query.lat ?? req.query.latitude);
    const lon = finiteCoord(req.query.lon ?? req.query.lng ?? req.query.longitude);
    if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return res.status(400).json({ message: 'พิกัด lat/lon ไม่ถูกต้อง' });
    }

    const rawType = req.query.type ?? req.query.types ?? '';
    const requested = String(rawType)
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
    const types = requested.length > 0
        ? requested.filter((t) => REST_STOP_FILTERS[t])
        : undefined; // undefined = default ของ service
    if (requested.length > 0 && types.length === 0) {
        return res.status(400).json({
            message: `type ไม่ถูกต้อง (ใช้ได้: ${Object.keys(REST_STOP_FILTERS).join(', ')})`,
        });
    }

    const radius = Math.min(20000, Math.max(500, Math.round(Number(req.query.radius) || 5000)));
    const limit = Math.min(20, Math.max(1, Math.round(Number(req.query.limit) || 10)));

    try {
        const stops = await searchRestStops(lat, lon, { radius, types, limit });
        res.json({ data: stops, attribution: REST_STOP_ATTRIBUTION });
    } catch (err) {
        console.error('[restStopController] getRestStops:', err.message);
        res.status(500).json({ message: 'ไม่สามารถค้นจุดแวะพักได้ในขณะนี้' });
    }
};

module.exports = { getRestStops };
