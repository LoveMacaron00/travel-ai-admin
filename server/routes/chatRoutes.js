// routes/chatRoutes.js
const express = require('express');
const router  = express.Router();
const {
    createSession, sendMessage, getMessages, getSessionByTrip
} = require('../controllers/chatController');
const { requireUserAuth } = require('../middleware/userAuth');

// POST /api/chat/sessions                           — สร้าง session ใหม่
// POST /api/chat/sessions/:sessionId/messages       — ส่งข้อความ + stream (SSE)
// GET  /api/chat/sessions/:sessionId/messages       — ดึงประวัติ
// GET  /api/chat/trips/:tripId/session              — ดึง session ล่าสุดของ trip

router.post('/sessions',                          requireUserAuth, createSession);
router.post('/sessions/:sessionId/messages',      requireUserAuth, sendMessage);
router.get('/sessions/:sessionId/messages',       requireUserAuth, getMessages);
router.get('/trips/:tripId/session',              requireUserAuth, getSessionByTrip);

module.exports = router;
