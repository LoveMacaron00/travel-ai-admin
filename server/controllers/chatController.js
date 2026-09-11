// server/controllers/chatController.js

const { ragChat } = require('../services/aiHelper');
const {
    analyzeTravelImage,
    detectImageMimeType,
} = require('../services/imageAnalysisHelper');
const { resolveAppLanguage } = require('../utils/appLanguage');
const {
    absoluteChatImagePath,
    deleteChatImage,
    saveChatImage,
} = require('../services/chatImageStorage');
const chatRepository = require('../repositories/chatRepository');
const {
    IMAGE_MESSAGES,
    MESSAGE_TEXT,
    validateEditableMessage,
} = require('../validators/chatValidator');

// POST /api/chat/sessions — สร้าง session ใหม่
// สร้าง chat session ใหม่ให้ผู้ใช้ที่ล็อกอินอยู่
const createSession = async (req, res) => {
    try {
        const userId = req.user?.id || null;

        const session = await chatRepository.createSession(userId);

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

        // ดึง session
        const session = await chatRepository.findOwnedSession(sessionId, req.user?.id);
        if (!session) return res.status(404).json({ message: 'ไม่พบ session' });

        // ดึง chat history ย้อนหลัง 10 messages (5 คู่)
        const historyRows = await chatRepository.findRecentHistory(sessionId, 10);
        const chatHistory = historyRows.reverse();

        // stream คำตอบจาก RAG + Gemini
        await ragChat(sessionId, validated.message, chatHistory, res);

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

        const session = await chatRepository.findOwnedSession(sessionId, req.user?.id);
        if (!session) {
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

        const inserted = await chatRepository.insertImageMessagePair(sessionId, {
            userContent,
            imageFileName: storedImageFileName,
            mimeType: detectedMimeType,
            answer: result.answer,
            sourceChunkIds: result.sourceChunkIds,
            illustrationUrl: result.illustrationUrl,
        });
        imageCommitted = true;
        const userMessageId = inserted?.user_message_id;
        const assistantMessageId = inserted?.assistant_message_id;

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
        const session = await chatRepository.findOwnedSession(req.params.sessionId, req.user?.id);
        if (!session) return res.status(404).json({ message: 'ไม่พบ session' });
        const rows = await chatRepository.findSessionMessages(req.params.sessionId);

        const allChunkIds = [...new Set(rows.flatMap(r => r.source_chunk_ids || []).filter(Boolean))];
        let destinationMap = new Map();
        if (allChunkIds.length > 0) {
            const destRows = await chatRepository.findDestinationsByIds(allChunkIds);
            destinationMap = new Map(destRows.map(d => [d.id, d]));
        }

        const enrichedRows = rows.map(r => {
            const chunkIds = r.source_chunk_ids || [];
            const sources = chunkIds
                .map(id => destinationMap.get(id))
                .filter(Boolean)
                .map(place => ({
                    id: place.id,
                    name: place.name,
                    province: place.province,
                    category: place.category,
                    image_url: place.image_url,
                }));
            return {
                ...r,
                sources,
            };
        });

        res.json(enrichedRows);
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
        const target = await chatRepository.findEditableUserMessage(messageId, req.user?.id);
        if (!target) return res.status(404).json({ message: messages.notFound });
        if (target.image_path) {
            return res.status(400).json({ message: messages.imageCannotEdit });
        }

        const historyRows = await chatRepository.findHistoryBefore(
            target.session_id,
            target.created_at,
            target.id,
            10,
        );

        await ragChat(
            target.session_id,
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

    try {
        const deleted = await chatRepository.deleteUserMessageCascade(messageId, req.user?.id);
        if (!deleted) {
            return res.status(404).json({ message: messages.notFound });
        }

        if (deleted.imagePath) {
            try {
                await deleteChatImage(deleted.imagePath);
            } catch (cleanupError) {
                // ข้อความถูกลบแล้ว จึงเก็บ log ไว้ให้ระบบดูแลไฟล์ orphan ภายหลัง
                console.error('[chatController] delete message image:', cleanupError.message);
            }
        }
        return res.json({
            deleted_message_ids: [
                messageId,
                ...deleted.assistantIds,
            ],
        });
    } catch (error) {
        console.error('[chatController] deleteMessage:', error.message);
        return res.status(500).json({ message: messages.deleteFailed });
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
        const image = await chatRepository.findMessageImage(messageId, req.user?.id);
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

// GET /api/chat/sessions/latest — session แชทล่าสุดของ user
// คืน chat session ล่าสุดของผู้ใช้ หรือ 404 เมื่อยังไม่มี
const getLatestSession = async (req, res) => {
    try {
        const latest = await chatRepository.findLatestSession(req.user?.id);
        if (!latest) return res.status(404).json({ message: 'ไม่พบ session' });
        res.json(latest);
    } catch (err) {
        console.error('[chatController] getLatestSession:', err.message);
        res.status(500).json({ message: 'เกิดข้อผิดพลาด' });
    }
};

// POST /api/chat/navigation — บันทึกการนำทางจากแชทไปแผนที่
const logNavigation = async (req, res) => {
    try {
        const { messageId, destinationId, sessionId } = req.body;
        const userId = req.user?.id || null;

        if (!messageId || !destinationId || !sessionId) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        const saved = await chatRepository.insertNavigationEvent({
            messageId,
            destinationId,
            userId,
            sessionId,
        });

        res.status(201).json({
            success: true,
            data: saved
        });
    } catch (err) {
        console.error('[chatController] logNavigation:', err.message);
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
    updateMessage,
    logNavigation,
};
