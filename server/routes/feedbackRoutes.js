// server/routes/feedbackRoutes.js

const express = require('express');
const router = express.Router();
const feedbackController = require('../controllers/feedbackController');
const { requireAdminAuth } = require('../middleware/adminAuth');

// Admin only routes
router.get('/', requireAdminAuth, feedbackController.getAllFeedback);
router.put('/:id', requireAdminAuth, feedbackController.updateFeedback);

module.exports = router;
