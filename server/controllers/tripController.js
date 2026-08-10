// server/controllers/tripController.js

const pool = require('../config/db');
const { generateTripPlan } = require('./helpers/aiHelper');
const {
    normalizePlanPlaces,
    sanitizePlaceholderPlanImages,
} = require('./helpers/planPlaceNormalizer');

const getApprovedPlanPlaces = async () => {
    const { rows } = await pool.query(
        `SELECT id, name, image_url, latitude, longitude
         FROM destinations
         WHERE status = 'approved'`,
    );
    return rows;
};

const normalizeStoredPlan = (planData, places) => {
    normalizePlanPlaces(planData, places);
    sanitizePlaceholderPlanImages(planData);
};

// POST /api/trips — สร้าง trip ใหม่แล้ว stream แผน
// สร้างแผนท่องเที่ยวด้วย AI และบันทึกเป็น trip ของผู้ใช้
const createTripHandler = ({ database = pool, planGenerator = generateTripPlan } = {}) => async (req, res) => {
    let tripId;
    try {
        const userId = req.user?.id || null;

        const { rows } = await database.query(
            `INSERT INTO trips
                (user_id, destination, province, days, budget, currency,
                 travel_style, group_type, interests, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'generating')
             RETURNING id`,
            [
                userId,
                req.body.destination || 'Near current location',
                req.body.province || null,
                req.body.days || 3,
                req.body.budget || null,
                req.body.currency || 'THB',
                req.body.travel_style || null,
                req.body.group_type || null,
                JSON.stringify(req.body.interests || []),
            ]
        );
        tripId = rows[0].id;

        // stream แผนเที่ยวกลับไปเลย
        await planGenerator(tripId, req.body, res);

    } catch (err) {
        console.error('[tripController] createTrip:', err.message);
        if (tripId != null) {
            await database.query(`UPDATE trips SET status = 'failed' WHERE id = $1`, [tripId]).catch(() => {});
        }
        if (!res.headersSent) {
            res.status(500).json({ message: 'เกิดข้อผิดพลาดในการสร้างแผนเที่ยว' });
        }
    }
};

const createTrip = createTripHandler();

// GET /api/trips — ดึงประวัติแผนเที่ยวของ user
// คืนประวัติแผนท่องเที่ยวของผู้ใช้ที่ล็อกอินอยู่
const getUserTrips = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { rows } = await pool.query(
            `SELECT t.id, t.destination, t.province, t.days, t.budget,
                    t.travel_style, t.group_type, t.status, t.created_at,
                    tp.plan_data
             FROM trips t
             LEFT JOIN trip_plans tp ON tp.trip_id = t.id
             WHERE t.user_id = $1
             ORDER BY t.created_at DESC
             LIMIT 20`,
            [userId]
        );
        const places = await getApprovedPlanPlaces();
        for (const trip of rows) normalizeStoredPlan(trip.plan_data, places);
        res.json(rows);
    } catch (err) {
        console.error('[tripController] getUserTrips:', err.message);
        res.status(500).json({ message: 'เกิดข้อผิดพลาด' });
    }
};

// GET /api/trips/:id — ดึงแผนเที่ยวตาม ID
// คืนแผนท่องเที่ยวหนึ่งรายการเมื่อเป็นเจ้าของรายการนั้น
const getTripById = async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT t.*, tp.plan_data, tp.markdown_cache, tp.generated_at
             FROM trips t
             LEFT JOIN trip_plans tp ON tp.trip_id = t.id
             WHERE t.id = $1 AND t.user_id = $2`,
            [req.params.id, req.user?.id]
        );
        const trip = rows[0] || null;
        if (!trip) return res.status(404).json({ message: 'ไม่พบแผนเที่ยว' });
        normalizeStoredPlan(trip.plan_data, await getApprovedPlanPlaces());
        res.json(trip);
    } catch (err) {
        console.error('[tripController] getTripById:', err.message);
        res.status(500).json({ message: 'เกิดข้อผิดพลาด' });
    }
};

module.exports = { createTrip, getUserTrips, getTripById };
