// server/routes/chatRoutes.js

const express = require('express');
const router = express.Router();
const {
    analyzeImage,
    createSession,
    deleteMessage,
    getLatestSession,
    getMessageImage,
    getMessages,
    sendMessage,
    updateMessage,
    logNavigation,
} = require('../controllers/chatController');
const { requireUserAuth } = require('../middleware/userAuth');
const imageUpload = require('../config/imageUpload');

// POST /api/chat/sessions — สร้าง session ใหม่
// POST /api/chat/sessions/:sessionId/messages — ส่งข้อความ + stream (SSE)
// GET /api/chat/sessions/:sessionId/messages — ดึงประวัติ

router.post('/sessions', requireUserAuth, createSession);
router.get('/sessions/latest', requireUserAuth, getLatestSession);
router.post('/sessions/:sessionId/messages', requireUserAuth, sendMessage);
router.post('/sessions/:sessionId/images', requireUserAuth, imageUpload.single('image'), analyzeImage);
router.get('/sessions/:sessionId/messages', requireUserAuth, getMessages);
router.get('/messages/:messageId/image', requireUserAuth, getMessageImage);
router.patch('/messages/:messageId', requireUserAuth, updateMessage);
router.delete('/messages/:messageId', requireUserAuth, deleteMessage);
router.post('/navigation', requireUserAuth, logNavigation);

module.exports = router;
