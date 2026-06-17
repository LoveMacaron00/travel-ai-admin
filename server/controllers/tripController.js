// tripController.js — CRUD trips + plan generation

const TripModel = require('../models/tripModel');
const { generateTripPlan } = require('../services/aiService');

// POST /api/trips — สร้าง trip ใหม่แล้ว stream แผน
const createTrip = async (req, res) => {
    try {
        const { destination } = req.body;

        if (!destination) {
            return res.status(400).json({ message: 'กรุณาระบุจุดหมายปลายทาง' });
        }

        const userId = req.user?.id || null;

        const tripId = await TripModel.create(req.body, userId);

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
        const trips = await TripModel.getByUserId(userId);
        res.json(trips);
    } catch (err) {
        console.error('[tripController] getUserTrips:', err.message);
        res.status(500).json({ message: 'เกิดข้อผิดพลาด' });
    }
};

// GET /api/trips/:id — ดึงแผนเที่ยวตาม ID
const getTripById = async (req, res) => {
    try {
        const trip = await TripModel.getById(req.params.id);
        if (!trip) return res.status(404).json({ message: 'ไม่พบแผนเที่ยว' });
        res.json(trip);
    } catch (err) {
        console.error('[tripController] getTripById:', err.message);
        res.status(500).json({ message: 'เกิดข้อผิดพลาด' });
    }
};

module.exports = { createTrip, getUserTrips, getTripById };