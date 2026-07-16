// server/controllers/chatController.js

const pool = require('../config/db');
const { ragChat } = require('./helpers/aiHelper');
const { analyzeTravelImage } = require('./helpers/imageAnalysisHelper');

// POST /api/chat/sessions — สร้าง session ใหม่สำหรับ trip
const createSession = async (req, res) => {
    try {
        const { trip_id } = req.body;
        const userId = req.user?.id || null;

        if (trip_id) {
            const { rows: tripRows } = await pool.query(
                'SELECT id FROM trips WHERE id = $1 AND user_id = $2',
                [trip_id, userId],
            );
            if (!tripRows[0]) return res.status(404).json({ message: 'ไม่พบแผนเที่ยว' });
        }

        const { rows } = await pool.query(
            `INSERT INTO chat_sessions (user_id, trip_id)
             VALUES ($1, $2) RETURNING id, created_at`,
            [userId, trip_id]
        );
        const session = rows[0];

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
        const { rows: sessionRows } = await pool.query(
            'SELECT id, trip_id FROM chat_sessions WHERE id = $1 AND user_id = $2',
            [sessionId, req.user?.id]
        );
        const session = sessionRows[0] || null;
        if (!session) return res.status(404).json({ message: 'ไม่พบ session' });

        const { trip_id } = session;

        // ดึง chat history ย้อนหลัง 10 messages (5 คู่)
        const { rows: historyRows } = await pool.query(
            `SELECT role, content FROM chat_messages
             WHERE session_id = $1
             ORDER BY created_at DESC
             LIMIT $2`,
            [sessionId, 10]
        );
        const chatHistory = historyRows.reverse();

        // stream คำตอบจาก RAG + Gemini
        await ragChat(sessionId, trip_id, message, chatHistory, res);

    } catch (err) {
        console.error('[chatController] sendMessage:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ message: 'เกิดข้อผิดพลาด' });
        }
    }
};

// POST /api/chat/sessions/:sessionId/images — วิเคราะห์ภาพโดยไม่จัดเก็บไฟล์ต้นฉบับ
const analyzeImage = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const mode = String(req.body.mode || '').trim().toLowerCase();
        if (!req.file) return res.status(400).json({ message: 'กรุณาแนบรูปภาพ' });

        const { rows: sessionRows } = await pool.query(
            'SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2',
            [sessionId, req.user?.id],
        );
        if (!sessionRows[0]) return res.status(404).json({ message: 'ไม่พบ session' });

        const latitude = Number(req.body.latitude);
        const longitude = Number(req.body.longitude);
        const result = await analyzeTravelImage({
            mode,
            imageBuffer: req.file.buffer,
            mimeType: req.file.mimetype,
            latitude: Number.isFinite(latitude) ? latitude : null,
            longitude: Number.isFinite(longitude) ? longitude : null,
        });

        const userContent = {
            place: 'Scanned a place photo',
            sign: 'Scanned a Thai sign',
            food: 'Scanned a Thai food photo',
        }[mode] || 'Scanned a photo';

        await pool.query(
            `INSERT INTO chat_messages (session_id, role, content, source_chunk_ids)
             VALUES ($1, 'user', $2, '{}'), ($1, 'assistant', $3, $4)`,
            [sessionId, userContent, result.answer, result.sourceChunkIds || []],
        );

        res.json({
            answer: result.answer,
            analysis: result.analysis,
        });
    } catch (err) {
        console.error('[chatController] analyzeImage:', err.message);
        res.status(err.statusCode || 500).json({
            message: err.publicMessage || 'ไม่สามารถวิเคราะห์รูปภาพได้ในขณะนี้',
        });
    }
};

// GET /api/chat/sessions/:sessionId/messages — ดึงประวัติ chat
const getMessages = async (req, res) => {
    try {
        const { rows: sessionRows } = await pool.query(
            'SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2',
            [req.params.sessionId, req.user?.id],
        );
        if (!sessionRows[0]) return res.status(404).json({ message: 'ไม่พบ session' });
        const { rows } = await pool.query(
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

// GET /api/chat/sessions/latest — session แชททั่วไปล่าสุดของ user
const getLatestSession = async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, trip_id, created_at FROM chat_sessions
             WHERE user_id = $1 AND trip_id IS NULL
             ORDER BY created_at DESC LIMIT 1`,
            [req.user?.id],
        );
        if (!rows[0]) return res.status(404).json({ message: 'ไม่พบ session' });
        res.json(rows[0]);
    } catch (err) {
        console.error('[chatController] getLatestSession:', err.message);
        res.status(500).json({ message: 'เกิดข้อผิดพลาด' });
    }
};

// GET /api/chat/trips/:tripId/session — ดึง session ล่าสุดของ trip
const getSessionByTrip = async (req, res) => {
    try {
        const userId = req.user?.id || null;
        const { rows } = await pool.query(
            `SELECT id, trip_id, created_at FROM chat_sessions
             WHERE trip_id = $1 AND ($2::int IS NULL OR user_id = $2)
             ORDER BY created_at DESC LIMIT 1`,
            [req.params.tripId, userId]
        );
        const session = rows[0] || null;
        
        if (!session) return res.status(404).json({ message: 'ไม่พบ session' });
        res.json(session);
    } catch (err) {
        console.error('[chatController] getSessionByTrip:', err.message);
        res.status(500).json({ message: 'เกิดข้อผิดพลาด' });
    }
};

module.exports = {
    createSession,
    sendMessage,
    analyzeImage,
    getMessages,
    getLatestSession,
    getSessionByTrip,
};
