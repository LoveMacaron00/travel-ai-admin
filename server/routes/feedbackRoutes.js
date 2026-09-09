// server/routes/feedbackRoutes.js

const express = require('express');
const router = express.Router();
const feedbackController = require('../controllers/feedbackController');
const { requireAdminAuth } = require('../middleware/adminAuth');

// GET /api/feedback — รายการ feedback ทั้งหมดจากผู้ใช้ (เฉพาะแอดมิน)
router.get('/', requireAdminAuth, feedbackController.getAllFeedback);
// PUT /api/feedback/:id — อัปเดตสถานะการจัดการ feedback (เฉพาะแอดมิน)
router.put('/:id', requireAdminAuth, feedbackController.updateFeedback);

module.exports = router;
