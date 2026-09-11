// server/routes/tripRoutes.js

const express = require('express');
const router = express.Router();
const { createTrip, getUserTrips, getTripById, deleteTrip, updateTripPlan, renameTrip } = require('../controllers/tripController');
const { requireUserAuth } = require('../middleware/userAuth');

// POST /api/trips — สร้าง trip + stream แผนเที่ยว (SSE)
// GET /api/trips — ดึงประวัติแผนเที่ยวของ user
// GET /api/trips/:id — ดึงแผนเที่ยวตาม ID
// PATCH /api/trips/:id — เปลี่ยนชื่อแผนเที่ยว
// PUT /api/trips/:id/plan — บันทึกการแก้ไขแผน (ลบ/เพิ่ม/สลับลำดับสถานที่)
// DELETE /api/trips/:id — ลบแผนเที่ยวตาม ID

router.post('/', requireUserAuth, createTrip);
router.get('/', requireUserAuth, getUserTrips);
router.get('/:id', requireUserAuth, getTripById);
router.patch('/:id', requireUserAuth, renameTrip);
router.put('/:id/plan', requireUserAuth, updateTripPlan);
router.delete('/:id', requireUserAuth, deleteTrip);

module.exports = router;
