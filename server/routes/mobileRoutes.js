const express = require('express');
const router = express.Router();
const mobileController = require('../controllers/mobileController');

router.get('/destinations', mobileController.getDestinations);
router.post('/chat', mobileController.chatWithAssistant);

module.exports = router;
