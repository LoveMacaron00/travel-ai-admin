const express = require('express');
const { heartbeat, endSession } = require('../controllers/activityController');
const { requireUserAuth } = require('../middleware/userAuth');

const router = express.Router();

router.post('/heartbeat', requireUserAuth, heartbeat);
router.post('/end', requireUserAuth, endSession);

module.exports = router;
