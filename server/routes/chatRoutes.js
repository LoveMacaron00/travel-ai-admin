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

// POST /api/chat/sessions — สร้าง session แชทใหม่ของผู้ใช้ (แอปเรียกเมื่อยังไม่มี session)
// GET /api/chat/sessions/latest — session ล่าสุดของผู้ใช้ (แอปเรียกก่อนเปิดแชท ถ้า 404 ค่อย POST /sessions)
// POST /api/chat/sessions/:sessionId/messages — ส่งข้อความหา AI + stream คำตอบเป็น SSE (RAG)
// POST /api/chat/sessions/:sessionId/images — อัปโหลดรูปสแกน (place/sign/food) แบบ multipart
// GET /api/chat/sessions/:sessionId/messages — ดึงประวัติแชท + enrich sources จาก source_chunk_ids
// GET /api/chat/messages/:messageId/image — ส่งไฟล์รูปที่แนบกับข้อความ (เฉพาะเจ้าของ session)
// PATCH /api/chat/messages/:messageId — แก้ข้อความ user แล้วให้ AI ตอบใหม่ (SSE)
// DELETE /api/chat/messages/:messageId — ลบข้อความ user + คำตอบ AI ที่ตอบคู่กัน
// POST /api/chat/navigation — บันทึกการกด "ดูบนแผนที่" จาก source card ในแชท (analytics)

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
