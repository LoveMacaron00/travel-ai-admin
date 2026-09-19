// server/repositories/provinceRepository.js
// ชั้นเข้าถึงฐานข้อมูลของตารางอ้างอิง 77 จังหวัด (ไทย/อังกฤษ + ภูมิภาค)
// ใช้ใน dropdown บันทึก diary — แยกจากรายชื่อจังหวัดของ plan ที่ดึงเฉพาะจังหวัดมีสถานที่
const pool = require('../config/db');

// 77 จังหวัดที่ active เรียงตาม sort_order — คืนแถวดิบให้ controller map label ตามภาษา
const findAllProvinces = async (db = pool) => {
    const { rows } = await db.query(
        `SELECT code, name_th, name_en, region, sort_order
          FROM provinces
          WHERE is_active = TRUE
          ORDER BY sort_order ASC, name_th ASC`,
    );
    return rows;
};

module.exports = { findAllProvinces };
