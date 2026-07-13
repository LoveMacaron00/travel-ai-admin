// server/routes/mobileRoutes.js

const express = require('express');
const router = express.Router();
const mobileController = require('../controllers/mobileController');

router.get('/destinations', mobileController.getDestinations);
router.get('/destinations/:id', mobileController.getDestinationDetail);
router.post('/chat', mobileController.chatWithAssistant);

module.exports = router;
