-- 001_add_trips_title.sql
-- เพิ่มคอลัมน์ title ให้ trips สำหรับชื่อแผนที่ผู้ใช้ตั้งเอง
-- รันซ้ำได้อย่างปลอดภัย (IF NOT EXISTS)
-- ใช้กับฐานข้อมูลเดิมที่สร้างจาก init.sql ก่อนจะมีคอลัมน์นี้
ALTER TABLE trips ADD COLUMN IF NOT EXISTS title VARCHAR(255);
