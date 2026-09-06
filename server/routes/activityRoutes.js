// activityRoutes.js สำหรับติดตามช่วงเวลาที่ผู้ใช้เปิดแอป

const express = require('express');
const { heartbeat } = require('../controllers/activityController');
const { requireUserAuth } = require('../middleware/userAuth');

const router = express.Router();

// POST /api/activity/heartbeat - ส่ง heartbeat ทุก 1 นาทีเพื่อบันทึกช่วงเวลาที่ผู้ใช้เปิดแอป
// (ไม่มี /end แล้ว: แอปเข้า background แค่หยุดส่ง heartbeat แล้วนับ inactive จาก last_seen_at)
router.post('/heartbeat', requireUserAuth, heartbeat);

module.exports = router;
