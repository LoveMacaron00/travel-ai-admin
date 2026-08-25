// server/routes/tripRoutes.js

const express = require('express');
const router = express.Router();
const { createTrip, getUserTrips, getTripById, deleteTrip } = require('../controllers/tripController');
const { requireUserAuth } = require('../middleware/userAuth');

// POST /api/trips — สร้าง trip + stream แผนเที่ยว (SSE)
// GET /api/trips — ดึงประวัติแผนเที่ยวของ user
// GET /api/trips/:id — ดึงแผนเที่ยวตาม ID
// DELETE /api/trips/:id — ลบแผนเที่ยวตาม ID

router.post('/', requireUserAuth, createTrip);
router.get('/', requireUserAuth, getUserTrips);
router.get('/:id', requireUserAuth, getTripById);
router.delete('/:id', requireUserAuth, deleteTrip);

module.exports = router;
