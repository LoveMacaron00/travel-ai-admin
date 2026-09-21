// server/repositories/chatRepository.js
// ชั้นเข้าถึงฐานข้อมูลของ chat — ย้าย SQL ออกจาก chatController
// รับ db เสริมได้ (pool หรือ transaction client) เพื่อให้ reuse และทดสอบได้
const pool = require('../config/db');

// สร้าง chat session ใหม่ คืน { id, created_at }
const createSession = async (userId, db = pool) => {
    const { rows } = await db.query(
        `INSERT INTO chat_sessions (user_id)
         VALUES ($1) RETURNING id, created_at`,
        [userId],
    );
    return rows[0];
};

// session ที่เป็นของผู้ใช้ คืน { id } หรือ null
const findOwnedSession = async (sessionId, userId, db = pool) => {
    const { rows } = await db.query(
        'SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2',
        [sessionId, userId],
    );
    return rows[0] || null;
};

// ประวัติย้อนหลัง N ข้อความ (ใหม่สุดก่อน ให้ caller reverse เองถ้าต้องการตามลำดับเวลา)
const findRecentHistory = async (sessionId, limit, db = pool) => {
    const { rows } = await db.query(
        `SELECT role, content FROM chat_messages
         WHERE session_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2`,
        [sessionId, limit],
    );
    return rows;
};

// บันทึกคู่ข้อความ user (รูป) + assistant (คำตอบ AI) พร้อมกัน
// คืน { user_message_id, assistant_message_id }
const insertImageMessagePair = async (sessionId, {
    userContent,
    imageFileName,
    mimeType,
    answer,
    sourceChunkIds,
    illustrationUrl,
}, db = pool) => {
    const { rows } = await db.query(
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
            imageFileName,
            mimeType,
            answer,
            sourceChunkIds || [],
            illustrationUrl || null,
        ],
    );
    return rows[0];
};

// บันทึกคู่ข้อความ user + assistant ของเทิร์นแชทปกติ
// คืน { user_message_id, assistant_message_id }
const insertChatMessagePair = async (sessionId, { userMessage, fullAnswer, sourceChunkIds }, db = pool) => {
    const { rows } = await db.query(
        `WITH new_user AS (
            INSERT INTO chat_messages (
                session_id, role, content, source_chunk_ids
            )
            VALUES ($1, 'user', $2, '{}')
            RETURNING id
         ), new_assistant AS (
            INSERT INTO chat_messages (
                session_id, role, content, source_chunk_ids,
                reply_to_message_id
            )
            SELECT $1, 'assistant', $3, $4, id
            FROM new_user
            RETURNING id, reply_to_message_id
         )
         SELECT new_user.id AS user_message_id,
                new_assistant.id AS assistant_message_id
         FROM new_user
         JOIN new_assistant
           ON new_assistant.reply_to_message_id = new_user.id`,
        [sessionId, userMessage, fullAnswer, sourceChunkIds],
    );
    return rows[0];
};

// อัปเดต prompt, ลบคำตอบเดิม และเพิ่มคำตอบใหม่ใน statement เดียว
// จึงไม่ทิ้งบทสนทนาไว้ครึ่งทางหากบันทึกฐานข้อมูลล้มเหลว
// คืน { user_message_id, assistant_message_id, deleted_assistant_message_ids } หรือ null
const replaceEditedMessage = async (sessionId, {
    userMessage,
    fullAnswer,
    sourceChunkIds,
    existingUserMessageId,
}, db = pool) => {
    const { rows } = await db.query(
        `WITH updated_user AS (
            UPDATE chat_messages
            SET content = $2, edited_at = NOW()
            WHERE id = $5
              AND session_id = $1
              AND role = 'user'
              AND image_path IS NULL
            RETURNING id, created_at
         ), deleted_assistants AS (
            DELETE FROM chat_messages
            WHERE session_id = $1
              AND role = 'assistant'
              AND reply_to_message_id IN (SELECT id FROM updated_user)
            RETURNING id
         ), new_assistant AS (
            INSERT INTO chat_messages (
                session_id, role, content, source_chunk_ids,
                reply_to_message_id, created_at
            )
            SELECT $1, 'assistant', $3, $4, id, created_at
            FROM updated_user
            RETURNING id, reply_to_message_id
         )
         SELECT new_assistant.id AS assistant_message_id,
                new_assistant.reply_to_message_id AS user_message_id,
                COALESCE(
                    (SELECT array_agg(id) FROM deleted_assistants),
                    '{}'::int[]
                ) AS deleted_assistant_message_ids
         FROM new_assistant`,
        [sessionId, userMessage, fullAnswer, sourceChunkIds, existingUserMessageId],
    );
    return rows[0] || null;
};

// ประวัติข้อความทั้ง session ตามลำดับเวลา
const findSessionMessages = async (sessionId, db = pool) => {
    const { rows } = await db.query(
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
        [sessionId],
    );
    return rows;
};

// สถานที่อ้างอิงจาก chunk ids สำหรับ enrich ประวัติ
const findDestinationsByIds = async (ids, db = pool) => {
    const { rows } = await db.query(
        `SELECT id, name, province, category, image_url
         FROM destinations
         WHERE id = ANY($1::int[])`,
        [ids],
    );
    return rows;
};

// ข้อความ user ที่แก้ไขได้ (เป็นเจ้าของ session) คืนแถวหรือ null
const findEditableUserMessage = async (messageId, userId, db = pool) => {
    const { rows } = await db.query(
        `SELECT cm.id, cm.session_id, cm.image_path, cm.created_at
         FROM chat_messages cm
         JOIN chat_sessions cs ON cs.id = cm.session_id
         WHERE cm.id = $1
           AND cs.user_id = $2
           AND cm.role = 'user'
         LIMIT 1`,
        [messageId, userId],
    );
    return rows[0] || null;
};

// ประวัติก่อนข้อความหนึ่งๆ ย้อนหลัง N ข้อความ (ใหม่สุดก่อน)
const findHistoryBefore = async (sessionId, createdAt, messageId, limit, db = pool) => {
    const { rows } = await db.query(
        `SELECT role, content
         FROM chat_messages
         WHERE session_id = $1
           AND (
               created_at < $2
               OR (created_at = $2 AND id < $3)
           )
         ORDER BY created_at DESC, id DESC
         LIMIT $4`,
        [sessionId, createdAt, messageId, limit],
    );
    return rows;
};

// ลบข้อความ user พร้อมคำตอบที่ผูกอยู่ (transaction เดียว)
// คืน { imagePath, assistantIds } หรือ null ถ้าไม่พบ/ไม่มีสิทธิ์
const deleteUserMessageCascade = async (messageId, userId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query(
            `SELECT cm.id, cm.image_path
             FROM chat_messages cm
             JOIN chat_sessions cs ON cs.id = cm.session_id
             WHERE cm.id = $1
               AND cs.user_id = $2
               AND cm.role = 'user'
             FOR UPDATE OF cm`,
            [messageId, userId],
        );
        const deletedMessage = rows[0] || null;
        if (!deletedMessage) {
            await client.query('ROLLBACK');
            return null;
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

        return {
            imagePath: deletedMessage.image_path,
            assistantIds: assistantRows.map((message) => message.id),
        };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
};

// ไฟล์ภาพของข้อความ (เฉพาะเจ้าของ session) คืนแถวหรือ null
const findMessageImage = async (messageId, userId, db = pool) => {
    const { rows } = await db.query(
        `SELECT cm.image_path, cm.image_mime_type
         FROM chat_messages cm
         JOIN chat_sessions cs ON cs.id = cm.session_id
         WHERE cm.id = $1
           AND cs.user_id = $2
           AND cm.image_path IS NOT NULL
         LIMIT 1`,
        [messageId, userId],
    );
    return rows[0] || null;
};

// session ล่าสุดของผู้ใช้ คืนแถวหรือ null
const findLatestSession = async (userId, db = pool) => {
    const { rows } = await db.query(
        `SELECT id, created_at FROM chat_sessions
         WHERE user_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [userId],
    );
    return rows[0] || null;
};

// บันทึก event นำทางจากแชทไปแผนที่ คืน { id, navigated_at }
const insertNavigationEvent = async ({ messageId, destinationId, userId, sessionId }, db = pool) => {
    const { rows } = await db.query(
        `INSERT INTO chat_navigation_events
         (chat_message_id, destination_id, user_id, session_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, navigated_at`,
        [messageId, destinationId, userId, sessionId],
    );
    return rows[0];
};

module.exports = {
    createSession,
    findOwnedSession,
    findRecentHistory,
    insertImageMessagePair,
    insertChatMessagePair,
    replaceEditedMessage,
    findSessionMessages,
    findDestinationsByIds,
    findEditableUserMessage,
    findHistoryBefore,
    deleteUserMessageCascade,
    findMessageImage,
    findLatestSession,
    insertNavigationEvent,
};
