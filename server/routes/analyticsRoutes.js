// server/routes/analyticsRoutes.js

const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');

// GET /api/analytics/overview?range=24h|7d|30d|90d — ภาพรวมสถิติผู้ใช้/สถานที่
// จากข้อมูล activity จริง (heartbeat, view) สำหรับ Dashboard แอดมิน
router.get('/overview', analyticsController.getOverview);
// GET /api/analytics/destinations/:id/trend — แนวโน้มยอดเปิดดูสถานที่หนึ่งแห่ง
// ตามช่วงเวลา สำหรับกราฟใน Dashboard แอดมิน
router.get('/destinations/:id/trend', analyticsController.getDestinationTrend);

module.exports = router;
