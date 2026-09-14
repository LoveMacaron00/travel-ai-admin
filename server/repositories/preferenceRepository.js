// server/repositories/preferenceRepository.js
// ชั้นเข้าถึงฐานข้อมูลของ plan preference options — ย้าย SQL ออกจาก preferenceController
const pool = require('../config/db');

const RETURNING_COLUMNS = `id, type, key, label_th, label_en, icon_url,
          is_active, sort_order, created_at, updated_at`;

// รายการตัวเลือกทั้งหมด (กรองตาม type ได้) เรียงตามประเภทและลำดับ
const listAll = async (type, db = pool) => {
    const params = [];
    let sql = `
        SELECT id, type, key, label_th, label_en, icon_url,
               is_active, sort_order, created_at, updated_at
        FROM plan_preference_options
    `;
    if (type) {
        params.push(type);
        sql += ` WHERE type = $${params.length}`;
    }
    sql += ` ORDER BY type, sort_order ASC, id ASC`;

    const { rows } = await db.query(sql, params);
    return rows;
};

// ลำดับถัดไปของหมวดหมู่ (สำหรับสร้างใหม่แบบไม่ระบุลำดับ)
const nextSortOrder = async (type, db = pool) => {
    const { rows } = await db.query(
        `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order
         FROM plan_preference_options WHERE type = $1`,
        [type],
    );
    return rows[0]?.next_order ?? 0;
};

// เพิ่มตัวเลือกใหม่ คืนแถวที่สร้าง
const createOption = async ({ type, key, labelTh, labelEn, iconUrl, sortOrder }, db = pool) => {
    const { rows } = await db.query(
        `INSERT INTO plan_preference_options
            (type, key, label_th, label_en, icon_url, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING ${RETURNING_COLUMNS}`,
        [type, key, labelTh, labelEn, iconUrl || null, sortOrder],
    );
    return rows[0];
};

// แก้ไขตัวเลือก คืนแถวที่อัปเดตหรือ null ถ้าไม่พบ
const updateOption = async (id, { type, key, labelTh, labelEn, iconUrl, sortOrder, isActive }, db = pool) => {
    // ไม่ระบุลำดับใหม่ให้คงลำดับเดิม (COALESCE ด้านขวาอ้างอิงค่าก่อนแก้ไข)
    const { rows } = await db.query(
        `UPDATE plan_preference_options
         SET type = $1, key = $2, label_th = $3, label_en = $4,
             icon_url = COALESCE($5, icon_url),
             sort_order = COALESCE($6, sort_order),
             is_active = $7, updated_at = NOW()
         WHERE id = $8
         RETURNING ${RETURNING_COLUMNS}`,
        [type, key, labelTh, labelEn, iconUrl, sortOrder, isActive, id],
    );
    return rows[0] || null;
};

// ลบตัวเลือก คืนจำนวนแถวที่ลบ
const removeOption = async (id, db = pool) => {
    const { rowCount } = await db.query(
        'DELETE FROM plan_preference_options WHERE id = $1',
        [id],
    );
    return rowCount;
};

// ตัวเลือกที่ใช้งานอยู่ทั้งหมดสำหรับแอปมือถือ
const findActive = async (db = pool) => {
    const { rows } = await db.query(
        `SELECT type, key, label_th, label_en, icon_url
         FROM plan_preference_options
         WHERE is_active = TRUE
         ORDER BY type, sort_order ASC, id ASC`,
    );
    return rows;
};

module.exports = {
    listAll,
    nextSortOrder,
    createOption,
    updateOption,
    removeOption,
    findActive,
};
