-- ลบ ended_at ออกจาก app_usage_sessions: ความ active ดูจาก last_seen_at อย่างเดียว
-- session ใหม่เกิดเมื่อ heartbeat ส่ง sessionId ที่ไม่พบ ส่วนการเข้า background
-- แค่หยุดส่ง heartbeat แล้วให้ server หมดอายุเองหลัง ~2 นาที
ALTER TABLE IF EXISTS app_usage_sessions DROP COLUMN IF EXISTS ended_at;
