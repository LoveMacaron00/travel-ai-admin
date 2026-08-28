// server/routes/feedbackRoutes.js

const express = require('express');
const router = express.Router();
const feedbackController = require('../controllers/feedbackController');
const { requireUserAuth } = require('../middleware/userAuth');
const { requireAdminAuth } = require('../middleware/adminAuth');

// Mobile users can create feedback
router.post('/', requireUserAuth, feedbackController.createFeedback);

// Mobile users can get their own feedback
router.get('/my', requireUserAuth, feedbackController.getUserFeedback);

// Admin only routes
router.get('/', requireAdminAuth, feedbackController.getAllFeedback);
router.put('/:id', requireAdminAuth, feedbackController.updateFeedback);

module.exports = router;
