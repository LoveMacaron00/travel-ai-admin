const express = require('express');
const router = express.Router();
const mobileController = require('../controllers/mobileController');

router.get('/popular-destinations', mobileController.getPopularDestinations);
router.post('/chat', mobileController.chatWithAssistant);

module.exports = router;
