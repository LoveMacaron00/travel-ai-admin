const pool = require('./db');

// รองรับฐานข้อมูลเดิมแบบ idempotent โดยไม่ต้องลบ chat history ที่มีอยู่
const ensureChatMediaSchema = async () => {
    await pool.query(`
        ALTER TABLE chat_messages
        ADD COLUMN IF NOT EXISTS image_path TEXT,
        ADD COLUMN IF NOT EXISTS image_mime_type VARCHAR(20),
        ADD COLUMN IF NOT EXISTS image_caption TEXT,
        ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS reply_to_message_id INT
    `);

    // ผูกคำตอบเก่ากับข้อความ user ล่าสุดที่อยู่ก่อนหน้า เพื่อให้ลบเป็นคู่ได้
    await pool.query(`
        UPDATE chat_messages AS assistant
        SET reply_to_message_id = (
            SELECT user_message.id
            FROM chat_messages AS user_message
            WHERE user_message.session_id = assistant.session_id
              AND user_message.role = 'user'
              AND (
                  user_message.created_at < assistant.created_at
                  OR (
                      user_message.created_at = assistant.created_at
                      AND user_message.id < assistant.id
                  )
              )
            ORDER BY user_message.created_at DESC, user_message.id DESC
            LIMIT 1
        )
        WHERE assistant.role = 'assistant'
          AND assistant.reply_to_message_id IS NULL
    `);

    await pool.query(`
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'chat_messages_reply_to_message_id_fkey'
                  AND conrelid = 'chat_messages'::regclass
            ) THEN
                ALTER TABLE chat_messages
                ADD CONSTRAINT chat_messages_reply_to_message_id_fkey
                FOREIGN KEY (reply_to_message_id)
                REFERENCES chat_messages(id)
                ON DELETE CASCADE;
            END IF;
        END
        $$
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_chat_messages_reply_to_message_id
        ON chat_messages(reply_to_message_id)
        WHERE reply_to_message_id IS NOT NULL
    `);
};

module.exports = { ensureChatMediaSchema };
