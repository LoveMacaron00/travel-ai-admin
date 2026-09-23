-- 005_drop_trip_start_coords.sql
-- ลบคอลัมน์พิกัดจุดเริ่มต้นของ trips (เคยใช้คำนวณขากลับ ซึ่งลบออกจากระบบแล้ว)
-- โค้ดปัจจุบันไม่อ้างอิงคอลัมน์เหล่านี้แล้ว รันซ้ำได้อย่างปลอดภัย (IF EXISTS)
-- ใช้กับฐานข้อมูลเดิมที่เคยผ่าน ensureTripsStartCoordsColumns มาก่อน
ALTER TABLE trips DROP COLUMN IF EXISTS start_latitude;
ALTER TABLE trips DROP COLUMN IF EXISTS start_longitude;
