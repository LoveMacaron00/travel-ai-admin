// =============================================================
// chatController.js — RAG chat session + messages
// =============================================================

const { query } = require('../db');
const { ragChat } = require('../services/aiService');

// POST /api/chat/sessions — สร้าง session ใหม่สำหรับ trip
const createSession = async (req, res) => {
    try {
        const { trip_id } = req.body;
        const userId = req.user?.id || null;

        if (!trip_id) return res.status(400).json({ message: 'กรุณาระบุ trip_id' });

        // ตรวจว่า trip มีอยู่จริง
        const { rows: tripRows } = await query(
            'SELECT id FROM trips WHERE id = $1', [trip_id]
        );
        if (tripRows.length === 0) return res.status(404).json({ message: 'ไม่พบแผนเที่ยว' });

        const { rows } = await query(
            `INSERT INTO chat_sessions (user_id, trip_id)
             VALUES ($1, $2) RETURNING id, created_at`,
            [userId, trip_id]
        );

        res.status(201).json(rows[0]);
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
        const { rows: sessRows } = await query(
            'SELECT id, trip_id FROM chat_sessions WHERE id = $1',
            [sessionId]
        );
        if (sessRows.length === 0) return res.status(404).json({ message: 'ไม่พบ session' });

        const { trip_id } = sessRows[0];

        // ดึง chat history ย้อนหลัง 10 messages (5 คู่)
        const { rows: historyRows } = await query(
            `SELECT role, content FROM chat_messages
             WHERE session_id = $1
             ORDER BY created_at DESC
             LIMIT 10`,
            [sessionId]
        );
        const chatHistory = historyRows.reverse(); // เรียงจากเก่าไปใหม่

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
        const { rows } = await query(
            `SELECT id, role, content, source_chunk_ids, created_at
             FROM chat_messages
             WHERE session_id = $1
             ORDER BY created_at ASC`,
            [req.params.sessionId]
        );
        res.json(rows);
    } catch (err) {
        console.error('[chatController] getMessages:', err.message);
        res.status(500).json({ message: 'เกิดข้อผิดพลาด' });
    }
};

// GET /api/chat/trips/:tripId/session — ดึง session ล่าสุดของ trip
const getSessionByTrip = async (req, res) => {
    try {
        const userId = req.user?.id || null;
        const { rows } = await query(
            `SELECT id, trip_id, created_at FROM chat_sessions
             WHERE trip_id = $1 AND ($2::int IS NULL OR user_id = $2)
             ORDER BY created_at DESC LIMIT 1`,
            [req.params.tripId, userId]
        );
        if (rows.length === 0) return res.status(404).json({ message: 'ไม่พบ session' });
        res.json(rows[0]);
    } catch (err) {
        console.error('[chatController] getSessionByTrip:', err.message);
        res.status(500).json({ message: 'เกิดข้อผิดพลาด' });
    }
};

module.exports = { createSession, sendMessage, getMessages, getSessionByTrip };
