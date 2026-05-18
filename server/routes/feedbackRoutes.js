const express = require('express');
const router = express.Router();
const feedbackController = require('../controllers/feedbackController');

router.get('/', feedbackController.getAllFeedback);
router.put('/:id', feedbackController.updateFeedback);

module.exports = router;
