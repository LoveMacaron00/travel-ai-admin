-- ลบ trip_id ออกจาก chat_sessions: ปัจจุบันไม่มี client ใดส่ง trip_id
-- ทุก session เป็นแชทรวม (trip_id เป็น NULL เสมอ) และ RAG ไม่ใช้ trip context แล้ว
DROP INDEX IF EXISTS idx_chat_sessions_trip;
ALTER TABLE IF EXISTS chat_sessions DROP COLUMN IF EXISTS trip_id;
