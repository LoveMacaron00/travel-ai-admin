// server/routes/tat.js

const express = require('express');
const router = express.Router();
const tatController = require('../controllers/tatController');

// GET /api/v2/places     - ค้นหาสถานที่จาก TAT API
router.get('/places', tatController.searchPlaces);

// GET /api/v2/places/:id - ดูรายละเอียดสถานที่จาก TAT API
router.get('/places/:id', tatController.getPlaceById);

module.exports = router;
