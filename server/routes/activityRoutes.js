// activityRoutes.js สำหรับติดตามช่วงเวลาที่ผู้ใช้เปิดแอป

const express = require('express');
const { heartbeat, endSession } = require('../controllers/activityController');
const { requireUserAuth } = require('../middleware/userAuth');

const router = express.Router();

// POST /api/activity/heartbeat - ส่ง heartbeat ทุก 1 นาทีเพื่อบันทึกช่วงเวลาที่ผู้ใช้เปิดแอป
// POST /api/activity/end - ส่งเมื่อผู้ใช้ปิดแอปเพื่อบันทึกช่วงเวลาที่ผู้ใช้เปิดแอป
router.post('/heartbeat', requireUserAuth, heartbeat);
router.post('/end', requireUserAuth, endSession);

module.exports = router;
