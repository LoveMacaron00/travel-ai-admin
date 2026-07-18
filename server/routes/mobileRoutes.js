// server/routes/mobileRoutes.js

const express = require('express');
const router = express.Router();
const mobileController = require('../controllers/mobileController');
const { recordDestinationView } = require('../controllers/destinationViewController');
const { requireUserAuth } = require('../middleware/userAuth');

router.get('/destinations', mobileController.getDestinations);
router.post('/destinations/:id/view', requireUserAuth, recordDestinationView);
router.get('/destinations/:id', mobileController.getDestinationDetail);

module.exports = router;
