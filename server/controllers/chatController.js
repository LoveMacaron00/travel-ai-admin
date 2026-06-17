// chatController.js — RAG chat session + messages

const ChatModel = require('../models/chatModel');
const { ragChat } = require('../services/aiService');

// POST /api/chat/sessions — สร้าง session ใหม่สำหรับ trip
const createSession = async (req, res) => {
    try {
        const { trip_id } = req.body;
        const userId = req.user?.id || null;

        if (!trip_id) return res.status(400).json({ message: 'กรุณาระบุ trip_id' });

        // ตรวจว่า trip มีอยู่จริง
        const trip = await ChatModel.getTripById(trip_id);
        if (!trip) return res.status(404).json({ message: 'ไม่พบแผนเที่ยว' });

        const session = await ChatModel.createSession(trip_id, userId);

        res.status(201).json(session);
    } catch (err) {
        console.error('[chatController] createSession:', err.message);
        res.status(500).json({ message: 'เกิดข้อผิดพลาด' });
    }
};

// POST /api/chat/sessions/:sessionId/messages — ส่งข้อความ + stream คำตอบ
const sendMessage = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { message } = req.body;

        if (!message?.trim()) return res.status(400).json({ message: 'กรุณาระบุข้อความ' });

        // ดึง session + trip_id
        const session = await ChatModel.getSessionById(sessionId);
        if (!session) return res.status(404).json({ message: 'ไม่พบ session' });

        const { trip_id } = session;

        // ดึง chat history ย้อนหลัง 10 messages (5 คู่)
        const chatHistory = await ChatModel.getHistoryMessages(sessionId, 10);

        // stream คำตอบจาก RAG + Gemini
        await ragChat(sessionId, trip_id, message, chatHistory, res);

    } catch (err) {
        console.error('[chatController] sendMessage:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ message: 'เกิดข้อผิดพลาด' });
        }
    }
};

// GET /api/chat/sessions/:sessionId/messages — ดึงประวัติ chat
const getMessages = async (req, res) => {
    try {
        const messages = await ChatModel.getMessagesBySession(req.params.sessionId);
        res.json(messages);
    } catch (err) {
        console.error('[chatController] getMessages:', err.message);
        res.status(500).json({ message: 'เกิดข้อผิดพลาด' });
    }
};

// GET /api/chat/trips/:tripId/session — ดึง session ล่าสุดของ trip
const getSessionByTrip = async (req, res) => {
    try {
        const userId = req.user?.id || null;
        const session = await ChatModel.getSessionByTrip(req.params.tripId, userId);
        
        if (!session) return res.status(404).json({ message: 'ไม่พบ session' });
        res.json(session);
    } catch (err) {
        console.error('[chatController] getSessionByTrip:', err.message);
        res.status(500).json({ message: 'เกิดข้อผิดพลาด' });
    }
};

module.exports = { createSession, sendMessage, getMessages, getSessionByTrip };