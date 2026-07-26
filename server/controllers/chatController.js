// server/controllers/chatController.js

const pool = require('../config/db');
const { ragChat } = require('./helpers/aiHelper');
const {
    analyzeTravelImage,
    detectImageMimeType,
} = require('./helpers/imageAnalysisHelper');
const { resolveAppLanguage } = require('./helpers/appLanguage');
const {
    absoluteChatImagePath,
    deleteChatImage,
    saveChatImage,
} = require('./helpers/chatImageStorage');

const IMAGE_MESSAGES = {
    en: {
        missingImage: 'Please attach a photo.',
        sessionNotFound: 'Chat session not found.',
        imageNotFound: 'Chat image not found.',
        rateLimited: 'AI usage limit reached. Please wait a moment and try again.',
        analysisFailed: 'The image could not be analyzed right now.',
        userContent: {
            place: 'Scanned a place photo',
            sign: 'Scanned a Thai sign',
            food: 'Scanned a Thai food photo',
            default: 'Scanned a photo',
        },
    },
    th: {
        missingImage: 'กรุณาแนบรูปภาพ',
        sessionNotFound: 'ไม่พบ Chat session',
        imageNotFound: 'ไม่พบรูปภาพในประวัติแชท',
        rateLimited: 'ถึงขีดจำกัดการใช้งาน AI กรุณารอสักครู่แล้วลองใหม่',
        analysisFailed: 'ไม่สามารถวิเคราะห์รูปภาพได้ในขณะนี้',
        userContent: {
            place: 'สแกนรูปสถานที่',
            sign: 'สแกนป้ายภาษาไทย',
            food: 'สแกนรูปอาหารไทย',
            default: 'สแกนรูปภาพ',
        },
    },
};

const MESSAGE_MAX_LENGTH = 2000;

const MESSAGE_TEXT = {
    en: {
        required: 'Please enter a message.',
        tooLong: `The message must not exceed ${MESSAGE_MAX_LENGTH} characters.`,
        notFound: 'Message not found.',
        imageCannotEdit: 'Photo messages cannot be edited. Delete the photo and scan it again.',
        editFailed: 'The message could not be edited.',
        deleteFailed: 'The message could not be deleted.',
    },
    th: {
        required: 'กรุณาระบุข้อความ',
        tooLong: `ข้อความต้องไม่เกิน ${MESSAGE_MAX_LENGTH} ตัวอักษร`,
        notFound: 'ไม่พบข้อความ',
        imageCannotEdit: 'ไม่สามารถแก้ไขข้อความรูปภาพได้ กรุณาลบแล้วสแกนรูปใหม่',
        editFailed: 'ไม่สามารถแก้ไขข้อความได้',
        deleteFailed: 'ไม่สามารถลบข้อความได้',
    },
};

// ตรวจและ trim ข้อความ user ก่อนนำไปแก้ไขหรือส่งเข้า AI
const validateEditableMessage = (value, languageCode = 'th') => {
    const text = MESSAGE_TEXT[languageCode] || MESSAGE_TEXT.th;
    const message = typeof value === 'string' ? value.trim() : '';
    if (!message) return { error: text.required };
    if (message.length > MESSAGE_MAX_LENGTH) return { error: text.tooLong };
    return { message };
};

// POST /api/chat/sessions — สร้าง session ใหม่สำหรับ trip
// สร้าง chat session ใหม่ให้ผู้ใช้ที่ล็อกอินอยู่
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
// บันทึกข้อความ user และ stream คำตอบ AI ผ่าน SSE
const sendMessage = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { message } = req.body;
        const languageCode = resolveAppLanguage(req.get('Accept-Language'));
        const validated = validateEditableMessage(message, languageCode);
        if (validated.error) return res.status(400).json({ message: validated.error });

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
             ORDER BY created_at DESC, id DESC
             LIMIT $2`,
            [sessionId, 10]
        );
        const chatHistory = historyRows.reverse();

        // stream คำตอบจาก RAG + Gemini
        await ragChat(sessionId, trip_id, validated.message, chatHistory, res);

    } catch (err) {
        console.error('[chatController] sendMessage:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ message: 'เกิดข้อผิดพลาด' });
        }
    }
};

// POST /api/chat/sessions/:sessionId/images — วิเคราะห์แล้วเก็บภาพเมื่อสำเร็จ
// วิเคราะห์ภาพที่อัปโหลดด้วย AI แล้วบันทึกเป็นข้อความใน chat session
const analyzeImage = async (req, res) => {
    const languageCode = resolveAppLanguage(req.get('Accept-Language'));
    const messages = IMAGE_MESSAGES[languageCode];
    let storedImageFileName = null;
    let imageCommitted = false;
    res.vary('Accept-Language');
    try {
        const { sessionId } = req.params;
        const mode = String(req.body.mode || '').trim().toLowerCase();
        if (!req.file) return res.status(400).json({ message: messages.missingImage });

        const { rows: sessionRows } = await pool.query(
            'SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2',
            [sessionId, req.user?.id],
        );
        if (!sessionRows[0]) {
            return res.status(404).json({ message: messages.sessionNotFound });
        }

        const latitude = Number(req.body.latitude);
        const longitude = Number(req.body.longitude);
        const result = await analyzeTravelImage({
            mode,
            imageBuffer: req.file.buffer,
            mimeType: req.file.mimetype,
            latitude: Number.isFinite(latitude) ? latitude : null,
            longitude: Number.isFinite(longitude) ? longitude : null,
            languageCode,
        });

        const userContent = messages.userContent[mode] || messages.userContent.default;
        const detectedMimeType = detectImageMimeType(req.file.buffer);
        storedImageFileName = await saveChatImage(req.file.buffer, detectedMimeType);

        const { rows: insertedRows } = await pool.query(
            `WITH new_user AS (
                INSERT INTO chat_messages (
                    session_id, role, content, source_chunk_ids,
                    image_path, image_mime_type, image_caption
                )
                VALUES ($1, 'user', $2, '{}', $3, $4, $2)
                RETURNING id
             ), new_assistant AS (
                INSERT INTO chat_messages (
                    session_id, role, content, source_chunk_ids,
                    reply_to_message_id, image_url
                )
                SELECT $1, 'assistant', $5, $6, id, $7
                FROM new_user
                RETURNING id, reply_to_message_id
             )
             SELECT new_user.id AS user_message_id,
                    new_assistant.id AS assistant_message_id
             FROM new_user
             JOIN new_assistant
               ON new_assistant.reply_to_message_id = new_user.id`,
            [
                sessionId,
                userContent,
                storedImageFileName,
                detectedMimeType,
                result.answer,
                result.sourceChunkIds || [],
                result.illustrationUrl || null,
            ],
        );
        imageCommitted = true;
        const userMessageId = insertedRows[0]?.user_message_id;
        const assistantMessageId = insertedRows[0]?.assistant_message_id;

        res.json({
            answer: result.answer,
            analysis: result.analysis,
            user_message_id: userMessageId || null,
            assistant_message_id: assistantMessageId || null,
            image_url: userMessageId
                ? `/api/chat/messages/${userMessageId}/image`
                : null,
            assistant_image_url: result.illustrationUrl || null,
        });
    } catch (err) {
        if (storedImageFileName && !imageCommitted) {
            try {
                await deleteChatImage(storedImageFileName);
            } catch (cleanupError) {
                console.error('[chatController] cleanup chat image:', cleanupError.message);
            }
        }
        console.error('[chatController] analyzeImage:', err.message);
        if (err.statusCode === 429) {
            return res.status(429).json({
                message: messages.rateLimited,
                retry_after_seconds: err.retryAfterSeconds,
            });
        }
        const isLocalizedInputError = languageCode === 'th' && err.statusCode === 400;
        res.status(err.statusCode || 500).json({
            message: languageCode === 'th' && !isLocalizedInputError
                ? messages.analysisFailed
                : err.publicMessage || messages.analysisFailed,
        });
    }
};

// GET /api/chat/sessions/:sessionId/messages — ดึงประวัติ chat
// คืนประวัติข้อความของ session เมื่อผู้ใช้เป็นเจ้าของ
const getMessages = async (req, res) => {
    try {
        const { rows: sessionRows } = await pool.query(
            'SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2',
            [req.params.sessionId, req.user?.id],
        );
        if (!sessionRows[0]) return res.status(404).json({ message: 'ไม่พบ session' });
        const { rows } = await pool.query(
            `SELECT id, role, content, source_chunk_ids, image_caption,
                    reply_to_message_id,
                    edited_at, created_at,
                    COALESCE(
                        image_url,
                        CASE
                            WHEN image_path IS NOT NULL
                            THEN '/api/chat/messages/' || id || '/image'
                            ELSE NULL
                        END
                    ) AS image_url
             FROM chat_messages
             WHERE session_id = $1
             ORDER BY created_at ASC, id ASC`,
            [req.params.sessionId]
        );
        res.json(rows);
    } catch (err) {
        console.error('[chatController] getMessages:', err.message);
        res.status(500).json({ message: 'เกิดข้อผิดพลาด' });
    }
};

// PATCH /api/chat/messages/:messageId — แก้ไขได้เฉพาะข้อความของเจ้าของ session
// แก้ไขข้อความ user แล้วสร้างคำตอบ AI ของข้อความนั้นใหม่
const updateMessage = async (req, res) => {
    const languageCode = resolveAppLanguage(req.get('Accept-Language'));
    const messages = MESSAGE_TEXT[languageCode];
    const messageId = Number(req.params.messageId);
    const validated = validateEditableMessage(req.body?.message, languageCode);
    res.vary('Accept-Language');
    if (!Number.isInteger(messageId) || messageId <= 0) {
        return res.status(404).json({ message: messages.notFound });
    }
    if (validated.error) return res.status(400).json({ message: validated.error });

    try {
        const { rows } = await pool.query(
            `SELECT cm.id, cm.session_id, cm.image_path, cm.created_at,
                    cs.trip_id
             FROM chat_messages cm
             JOIN chat_sessions cs ON cs.id = cm.session_id
             WHERE cm.id = $1
               AND cs.user_id = $2
               AND cm.role = 'user'
             LIMIT 1`,
            [messageId, req.user?.id],
        );
        const target = rows[0] || null;
        if (!target) return res.status(404).json({ message: messages.notFound });
        if (target.image_path) {
            return res.status(400).json({ message: messages.imageCannotEdit });
        }

        const { rows: historyRows } = await pool.query(
            `SELECT role, content
             FROM chat_messages
             WHERE session_id = $1
               AND (
                   created_at < $2
                   OR (created_at = $2 AND id < $3)
               )
             ORDER BY created_at DESC, id DESC
             LIMIT $4`,
            [target.session_id, target.created_at, target.id, 10],
        );

        await ragChat(
            target.session_id,
            target.trip_id,
            validated.message,
            historyRows.reverse(),
            res,
            { existingUserMessageId: target.id },
        );
    } catch (error) {
        console.error('[chatController] updateMessage:', error.message);
        if (!res.headersSent) {
            return res.status(500).json({ message: messages.editFailed });
        }
    }
};

// DELETE /api/chat/messages/:messageId — ลบข้อความและไฟล์ภาพของเจ้าของเท่านั้น
// ลบข้อความ user พร้อมคำตอบและไฟล์ภาพที่ผูกอยู่
const deleteMessage = async (req, res) => {
    const languageCode = resolveAppLanguage(req.get('Accept-Language'));
    const messages = MESSAGE_TEXT[languageCode];
    const messageId = Number(req.params.messageId);
    res.vary('Accept-Language');
    if (!Number.isInteger(messageId) || messageId <= 0) {
        return res.status(404).json({ message: messages.notFound });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const { rows } = await client.query(
            `SELECT cm.id, cm.image_path
             FROM chat_messages cm
             JOIN chat_sessions cs ON cs.id = cm.session_id
             WHERE cm.id = $1
               AND cs.user_id = $2
               AND cm.role = 'user'
             FOR UPDATE OF cm`,
            [messageId, req.user?.id],
        );
        const deletedMessage = rows[0] || null;
        if (!deletedMessage) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: messages.notFound });
        }

        const { rows: assistantRows } = await client.query(
            `SELECT id
             FROM chat_messages
             WHERE reply_to_message_id = $1
               AND role = 'assistant'`,
            [messageId],
        );
        await client.query('DELETE FROM chat_messages WHERE id = $1', [messageId]);
        await client.query('COMMIT');

        if (deletedMessage.image_path) {
            try {
                await deleteChatImage(deletedMessage.image_path);
            } catch (cleanupError) {
                // ข้อความถูกลบแล้ว จึงเก็บ log ไว้ให้ระบบดูแลไฟล์ orphan ภายหลัง
                console.error('[chatController] delete message image:', cleanupError.message);
            }
        }
        return res.json({
            deleted_message_ids: [
                messageId,
                ...assistantRows.map((message) => message.id),
            ],
        });
    } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        console.error('[chatController] deleteMessage:', error.message);
        return res.status(500).json({ message: messages.deleteFailed });
    } finally {
        client?.release();
    }
};

// GET /api/chat/messages/:messageId/image — ส่งรูปเมื่อ session เป็นของผู้ใช้
// ส่งไฟล์ภาพจากข้อความเมื่อผู้ใช้เป็นเจ้าของ session
const getMessageImage = async (req, res) => {
    const languageCode = resolveAppLanguage(req.get('Accept-Language'));
    const messages = IMAGE_MESSAGES[languageCode];
    const messageId = Number(req.params.messageId);
    if (!Number.isInteger(messageId) || messageId <= 0) {
        return res.status(404).json({ message: messages.imageNotFound });
    }

    try {
        const { rows } = await pool.query(
            `SELECT cm.image_path, cm.image_mime_type
             FROM chat_messages cm
             JOIN chat_sessions cs ON cs.id = cm.session_id
             WHERE cm.id = $1
               AND cs.user_id = $2
               AND cm.image_path IS NOT NULL
             LIMIT 1`,
            [messageId, req.user?.id],
        );
        const image = rows[0] || null;
        const imagePath = absoluteChatImagePath(image?.image_path);
        if (!image || !imagePath) {
            return res.status(404).json({ message: messages.imageNotFound });
        }

        res.setHeader('Cache-Control', 'private, max-age=86400');
        res.type(image.image_mime_type || 'application/octet-stream');
        return res.sendFile(imagePath, (error) => {
            if (!error) return;
            if (res.headersSent) return res.destroy(error);
            const statusCode = error.code === 'ENOENT' ? 404 : 500;
            res.status(statusCode).json({ message: messages.imageNotFound });
        });
    } catch (error) {
        console.error('[chatController] getMessageImage:', error.message);
        return res.status(500).json({ message: messages.imageNotFound });
    }
};

// GET /api/chat/sessions/latest — session แชททั่วไปล่าสุดของ user
// คืน chat session ล่าสุดของผู้ใช้ หรือ 404 เมื่อยังไม่มี
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
// คืน chat session ที่ผูกกับ trip ของผู้ใช้
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
    deleteMessage,
    getMessageImage,
    getMessages,
    getLatestSession,
    getSessionByTrip,
    updateMessage,
};
