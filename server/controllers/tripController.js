// tripController.js — CRUD trips + plan generation

const pool = require('../config/db');
const { generateTripPlan } = require('./helpers/aiHelper');

// POST /api/trips — สร้าง trip ใหม่แล้ว stream แผน
const createTrip = async (req, res) => {
    try {
        const { destination } = req.body;

        if (!destination) {
            return res.status(400).json({ message: 'กรุณาระบุจุดหมายปลายทาง' });
        }

        const userId = req.user?.id || null;

        const { rows } = await pool.query(
            `INSERT INTO trips
                (user_id, destination, province, days, budget, currency,
                 travel_style, group_type, interests, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'generating')
             RETURNING id`,
            [
                userId,
                req.body.destination,
                req.body.province || null,
                req.body.days || 3,
                req.body.budget || null,
                req.body.currency || 'THB',
                req.body.travel_style || null,
                req.body.group_type || null,
                JSON.stringify(req.body.interests || []),
            ]
        );
        const tripId = rows[0].id;

        // stream แผนเที่ยวกลับไปเลย
        await generateTripPlan(tripId, req.body, res);

    } catch (err) {
        console.error('[tripController] createTrip:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ message: 'เกิดข้อผิดพลาดในการสร้างแผนเที่ยว' });
        }
    }
};

// GET /api/trips — ดึงประวัติแผนเที่ยวของ user
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
        res.json(rows);
    } catch (err) {
        console.error('[tripController] getUserTrips:', err.message);
        res.status(500).json({ message: 'เกิดข้อผิดพลาด' });
    }
};

// GET /api/trips/:id — ดึงแผนเที่ยวตาม ID
const getTripById = async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT t.*, tp.plan_data, tp.markdown_cache, tp.generated_at
             FROM trips t
             LEFT JOIN trip_plans tp ON tp.trip_id = t.id
             WHERE t.id = $1`,
            [req.params.id]
        );
        const trip = rows[0] || null;
        if (!trip) return res.status(404).json({ message: 'ไม่พบแผนเที่ยว' });
        res.json(trip);
    } catch (err) {
        console.error('[tripController] getTripById:', err.message);
        res.status(500).json({ message: 'เกิดข้อผิดพลาด' });
    }
};

module.exports = { createTrip, getUserTrips, getTripById };