-- 003_add_trips_start_date.sql
-- เพิ่มคอลัมน์ start_date ("YYYY-MM-DD", NULL = ไม่ระบุ) ให้ trips สำหรับวันที่เริ่มทริป
-- ใช้แสดงหัวข้อแต่ละวันเป็นวันที่จริง (start + day - 1) แม้เปิดแผนเก่าจาก Profile
-- รันซ้ำได้อย่างปลอดภัย (IF NOT EXISTS)
-- ใช้กับฐานข้อมูลเดิมที่สร้างจาก init.sql ก่อนจะมีคอลัมน์นี้
ALTER TABLE trips ADD COLUMN IF NOT EXISTS start_date DATE;
