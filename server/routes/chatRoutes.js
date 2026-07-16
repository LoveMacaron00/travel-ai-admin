// server/routes/chatRoutes.js

const express = require('express');
const router  = express.Router();
const {
    createSession, sendMessage, analyzeImage, getMessages, getLatestSession, getSessionByTrip
} = require('../controllers/chatController');
const { requireUserAuth } = require('../middleware/userAuth');
const imageUpload = require('../config/imageUpload');

// POST /api/chat/sessions                           — สร้าง session ใหม่
// POST /api/chat/sessions/:sessionId/messages       — ส่งข้อความ + stream (SSE)
// GET  /api/chat/sessions/:sessionId/messages       — ดึงประวัติ
// GET  /api/chat/trips/:tripId/session              — ดึง session ล่าสุดของ trip

router.post('/sessions',                          requireUserAuth, createSession);
router.get('/sessions/latest',                    requireUserAuth, getLatestSession);
router.post('/sessions/:sessionId/messages',      requireUserAuth, sendMessage);
router.post('/sessions/:sessionId/images',        requireUserAuth, imageUpload.single('image'), analyzeImage);
router.get('/sessions/:sessionId/messages',       requireUserAuth, getMessages);
router.get('/trips/:tripId/session',              requireUserAuth, getSessionByTrip);

module.exports = router;
