// server/validators/preferenceValidator.js
// ตรวจและ normalize ตัวเลือกแผนเที่ยวจากฟอร์ม admin — ย้ายออกจาก preferenceController
// โยน Error ที่มี statusCode 400 เมื่อข้อมูลไม่ถูกต้อง (Controller จับแล้วตอบ 400 เหมือนเดิม)

const ALLOWED_TYPES = new Set(['interest', 'transport_mode']);

// ค่าที่รับจากฟอร์ม admin → ชุดข้อมูลสำหรับ INSERT/UPDATE
// ตรวจสอบและ normalize key ให้เป็นตัวพิมพ์เล็กเสมอเพื่อกัน key ซ้ำซ้อน
const normalizePreferenceInput = (body) => {
    const type = String(body.type || '').trim();
    if (!ALLOWED_TYPES.has(type)) {
        const error = new Error('ประเภทตัวเลือกไม่ถูกต้อง');
        error.statusCode = 400;
        throw error;
    }

    const key = String(body.key || '').trim().toLowerCase();
    if (!key) {
        const error = new Error('กรุณากรอกคีย์ตัวเลือก');
        error.statusCode = 400;
        throw error;
    }

    const labelTh = String(body.label_th || '').trim();
    const labelEn = String(body.label_en || '').trim();
    if (!labelTh || !labelEn) {
        const error = new Error('กรุณากรอกชื่อภาษาไทยและภาษาอังกฤษ');
        error.statusCode = 400;
        throw error;
    }

    // null = ให้ระบบหาลำดับต่อท้ายอัตโนมัติ (สร้าง) หรือคงค่าเดิม (แก้ไข)
    const sortOrder = Number.isInteger(Number(body.sort_order))
        ? Number(body.sort_order)
        : null;

    const iconUrl = body.icon_url !== undefined
        ? (String(body.icon_url || '').trim() || null)
        : undefined;

    return { type, key, labelTh, labelEn, sortOrder, iconUrl };
};

module.exports = { ALLOWED_TYPES, normalizePreferenceInput };
