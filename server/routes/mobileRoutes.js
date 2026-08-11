// server/routes/mobileRoutes.js

const express = require('express');
const router = express.Router();
const mobileController = require('../controllers/mobileController');
const { proxyImage } = require('../controllers/mediaController');
const { recordDestinationView } = require('../controllers/destinationViewController');
const { requireUserAuth } = require('../middleware/userAuth');
const travelDiaryController = require('../controllers/travelDiaryController');

router.get('/media', proxyImage);
router.get('/provinces', mobileController.getProvinces);
router.get('/destinations', mobileController.getDestinations);
router.post('/destinations/:id/view', requireUserAuth, recordDestinationView);
router.get('/destinations/:id', mobileController.getDestinationDetail);
router.get('/diary', requireUserAuth, travelDiaryController.getEntries);
router.post('/diary', requireUserAuth, travelDiaryController.upsertEntry);
router.delete('/diary/:externalId', requireUserAuth, travelDiaryController.deleteEntry);

module.exports = router;
