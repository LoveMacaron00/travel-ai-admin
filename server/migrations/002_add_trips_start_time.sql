-- 002_add_trips_start_time.sql
-- เพิ่มคอลัมน์ start_time ("HH:MM", NULL = 09:00) ให้ trips สำหรับเวลาเริ่มเดินทาง
-- รันซ้ำได้อย่างปลอดภัย (IF NOT EXISTS)
-- ใช้กับฐานข้อมูลเดิมที่สร้างจาก init.sql ก่อนจะมีคอลัมน์นี้
ALTER TABLE trips ADD COLUMN IF NOT EXISTS start_time VARCHAR(5);
