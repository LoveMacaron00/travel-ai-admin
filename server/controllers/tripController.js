// server/controllers/tripController.js

const pool = require('../config/db');
const { generateTripPlan } = require('../services/aiHelper');
const {
    normalizePlanPlaces,
    sanitizePlaceholderPlanImages,
} = require('../utils/planPlaceNormalizer');
const tripRepository = require('../repositories/tripRepository');

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

        tripId = await tripRepository.createGeneratingTrip(
            {
                userId,
                destination: req.body.destination,
                province: req.body.province,
                days: req.body.days,
                budget: req.body.budget,
                currency: req.body.currency,
                travelStyle: req.body.travel_style,
                groupType: req.body.group_type,
                interests: req.body.interests,
            },
            database,
        );

        // stream แผนเที่ยวกลับไปเลย
        await planGenerator(tripId, req.body, res);

    } catch (err) {
        console.error('[tripController] createTrip:', err.message);
        if (tripId != null) {
            await tripRepository.markTripFailed(tripId, database).catch(() => {});
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
        const rows = await tripRepository.findUserTripsWithPlans(userId);
        const places = await tripRepository.findApprovedPlanPlaces();
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
        const trip = await tripRepository.findTripWithPlanById(req.params.id, req.user?.id);
        if (!trip) return res.status(404).json({ message: 'ไม่พบแผนเที่ยว' });
        normalizeStoredPlan(trip.plan_data, await tripRepository.findApprovedPlanPlaces());
        res.json(trip);
    } catch (err) {
        console.error('[tripController] getTripById:', err.message);
        res.status(500).json({ message: 'เกิดข้อผิดพลาด' });
    }
};

// PUT /api/trips/:id/plan — บันทึกการแก้ไขแผนของผู้ใช้ (ลบ/เพิ่ม/สลับลำดับสถานที่)
// รับ plan_data ทั้งก้อนจาก mobile app แล้ว upsert ลง trip_plans
const updateTripPlan = async (req, res) => {
    try {
        const tripId = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(tripId) || tripId <= 0) {
            return res.status(400).json({ message: 'trip id ไม่ถูกต้อง' });
        }

        const planData = req.body?.days ? req.body : null;
        if (!planData || !Array.isArray(planData.days)) {
            return res.status(400).json({ message: 'รูปแบบแผนการเดินทางไม่ถูกต้อง' });
        }
        sanitizePlaceholderPlanImages(planData);

        const owned = await tripRepository.isTripOwnedByUser(tripId, req.user?.id);
        if (!owned) {
            return res.status(404).json({ message: 'ไม่พบแผนเที่ยวหรือคุณไม่มีสิทธิ์แก้ไข' });
        }

        await tripRepository.upsertTripPlan(tripId, JSON.stringify(planData));

        res.json({ message: 'บันทึกแผนการเดินทางสำเร็จ' });
    } catch (err) {
        console.error('[tripController] updateTripPlan:', err.message);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการบันทึกแผนการเดินทาง' });
    }
};

// DELETE /api/trips/:id — ลบแผนเที่ยวตาม ID
// ลบแผนเที่ยวเมื่อเป็นเจ้าของรายการนั้น
const deleteTrip = async (req, res) => {
    try {
        const rowCount = await tripRepository.deleteTripById(req.params.id, req.user?.id);
        if (rowCount === 0) {
            return res.status(404).json({ message: 'ไม่พบแผนเที่ยวหรือคุณไม่มีสิทธิ์ลบ' });
        }
        res.json({ message: 'ลบแผนเที่ยวสำเร็จ' });
    } catch (err) {
        console.error('[tripController] deleteTrip:', err.message);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการลบแผนเที่ยว' });
    }
};

module.exports = { createTrip, getUserTrips, getTripById, deleteTrip, updateTripPlan };
