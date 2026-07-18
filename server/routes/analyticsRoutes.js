// server/routes/analyticsRoutes.js

const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');

// GET /api/analytics/overview?range=24h|7d|30d|90d - สถิติจาก activity จริง
router.get('/overview', analyticsController.getOverview);
router.get('/destinations/:id/trend', analyticsController.getDestinationTrend);

module.exports = router;
