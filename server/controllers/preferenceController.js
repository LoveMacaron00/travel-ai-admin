// server/controllers/preferenceController.js
// จัดการตัวเลือกของหน้าสร้างแผนเที่ยวในแอปมือถือ:
//   - interest       : "คุณชอบอะไร" (อาหาร, คาเฟ่, ธรรมชาติ, ...)
//   - transport_mode : "คุณเดินทางแบบใดได้บ้าง" (รถยนต์, เดิน, ...)
// Admin CRUD ผ่าน /api/preferences และแอปมือถืออ่านค่าที่ใช้งานผ่าน /api/mobile/plan-options

const pool = require('../config/db');
const { resolveTatLanguage } = require('./helpers/tatLanguage');

const ALLOWED_TYPES = new Set(['interest', 'transport_mode']);
// ไอคอนพาหนะที่แอปมือถือรู้จัก (map เป็น Material Icons ใน Flutter)
const TRANSPORT_ICONS = new Set([
    'car',
    'walking',
    'bus',
    'train',
    'ferry',
    'flight',
]);

// อ่านภาษาที่ผู้ใช้ร้องขอจาก Accept-Language
const requestLanguage = (req) => resolveTatLanguage(
    typeof req.get === 'function'
        ? req.get('Accept-Language')
        : req.headers?.['accept-language'],
);

// แจ้ง cache ว่า response แตกต่างกันตาม Accept-Language
const addLanguageVaryHeader = (res) => {
    if (typeof res.vary === 'function') res.vary('Accept-Language');
};

// ค่าที่รับจากฟอร์ม admin → ชุดข้อมูลสำหรับ INSERT/UPDATE
// ตรวจสอบและ normalize key ให้เป็นตัวพิมพ์เล็กเสมอเพื่อกัน key ซ้ำซ้อน
const normalizeInput = (body) => {
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

    let icon = body.icon ? String(body.icon).trim().toLowerCase() : '';
    if (type === 'interest') {
        icon = null;
    } else if (icon && !TRANSPORT_ICONS.has(icon)) {
        const error = new Error('ไอคอนพาหนะไม่ถูกต้อง');
        error.statusCode = 400;
        throw error;
    } else if (!icon) {
        // พาหนะไม่มีไอคอน ให้ใช้คีย์เป็นไอคอน (แอปรองรับเฉพาะชุดที่รู้จัก)
        icon = TRANSPORT_ICONS.has(key) ? key : null;
    }

    // null = ให้ระบบหาลำดับต่อท้ายอัตโนมัติ (สร้าง) หรือคงค่าเดิม (แก้ไข)
    const sortOrder = Number.isInteger(Number(body.sort_order))
        ? Number(body.sort_order)
        : null;

    return { type, key, labelTh, labelEn, icon, sortOrder };
};

// สร้าง controller สำหรับจัดการตัวเลือก โดยรับ database เพื่อทดสอบหรือสลับ dependency ได้
const createPreferenceControllers = (database) => {
    // Admin: รายการตัวเลือกทั้งหมด (รวมที่ปิดใช้งาน) เรียงตามประเภทและลำดับ
    const listPreferences = async (req, res) => {
        try {
            const type = req.query.type;
            if (type && !ALLOWED_TYPES.has(type)) {
                return res.status(400).json({ message: 'ประเภทตัวเลือกไม่ถูกต้อง' });
            }

            const params = [];
            let sql = `
                SELECT id, type, key, label_th, label_en, icon,
                       is_active, sort_order, created_at, updated_at
                FROM plan_preference_options
            `;
            if (type) {
                params.push(type);
                sql += ` WHERE type = $${params.length}`;
            }
            sql += ` ORDER BY type, sort_order ASC, id ASC`;

            const { rows } = await database.query(sql, params);
            res.json({ data: rows });
        } catch (err) {
            console.error('[preferenceController] list error:', err);
            res.status(500).json({ message: 'เกิดข้อผิดพลาดในการดึงตัวเลือก' });
        }
    };

    // Admin: เพิ่มตัวเลือกใหม่ (ไม่ระบุลำดับจะเรียงต่อท้ายหมวดหมู่อัตโนมัติ)
    const createPreference = async (req, res) => {
        try {
            const { type, key, labelTh, labelEn, icon, sortOrder } =
                normalizeInput(req.body);

            let nextOrder = sortOrder;
            if (nextOrder == null) {
                const { rows: maxRows } = await database.query(
                    `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order
                     FROM plan_preference_options WHERE type = $1`,
                    [type],
                );
                nextOrder = maxRows[0]?.next_order ?? 0;
            }

            const { rows } = await database.query(
                `INSERT INTO plan_preference_options
                    (type, key, label_th, label_en, icon, sort_order)
                 VALUES ($1,$2,$3,$4,$5,$6)
                 RETURNING id, type, key, label_th, label_en, icon,
                           is_active, sort_order, created_at, updated_at`,
                [type, key, labelTh, labelEn, icon, nextOrder],
            );
            res.status(201).json({ data: rows[0] });
        } catch (err) {
            console.error('[preferenceController] create error:', err);
            if (err.statusCode === 400) {
                return res.status(400).json({ message: err.message });
            }
            if (err.code === '23505') {
                return res.status(409).json({
                    message: 'คีย์นี้มีอยู่แล้วในหมวดหมู่นี้ กรุณาใช้คีย์อื่น',
                });
            }
            res.status(500).json({ message: 'เกิดข้อผิดพลาดในการเพิ่มตัวเลือก' });
        }
    };

    // Admin: แก้ไขตัวเลือก (รวมถึงเปิด/ปิดใช้งานผ่าน is_active)
    const updatePreference = async (req, res) => {
        try {
            const id = Number.parseInt(req.params.id, 10);
            if (!Number.isInteger(id)) {
                return res.status(400).json({ message: 'รหัสตัวเลือกไม่ถูกต้อง' });
            }

            const { type, key, labelTh, labelEn, icon, sortOrder } =
                normalizeInput(req.body);
            const isActive = req.body.is_active !== false;

            // ไม่ระบุลำดับใหม่ให้คงลำดับเดิม (COALESCE ด้านขวาอ้างอิงค่าก่อนแก้ไข)
            const { rows } = await database.query(
                `UPDATE plan_preference_options
                 SET type = $1, key = $2, label_th = $3, label_en = $4,
                     icon = $5, sort_order = COALESCE($6, sort_order),
                     is_active = $7, updated_at = NOW()
                 WHERE id = $8
                 RETURNING id, type, key, label_th, label_en, icon,
                           is_active, sort_order, created_at, updated_at`,
                [type, key, labelTh, labelEn, icon, sortOrder, isActive, id],
            );
            if (!rows[0]) {
                return res.status(404).json({ message: 'ไม่พบตัวเลือกนี้' });
            }
            res.json({ data: rows[0] });
        } catch (err) {
            console.error('[preferenceController] update error:', err);
            if (err.statusCode === 400) {
                return res.status(400).json({ message: err.message });
            }
            if (err.code === '23505') {
                return res.status(409).json({
                    message: 'คีย์นี้มีอยู่แล้วในหมวดหมู่นี้ กรุณาใช้คีย์อื่น',
                });
            }
            res.status(500).json({ message: 'เกิดข้อผิดพลาดในการแก้ไขตัวเลือก' });
        }
    };

    // Admin: ลบตัวเลือก
    const deletePreference = async (req, res) => {
        try {
            const id = Number.parseInt(req.params.id, 10);
            if (!Number.isInteger(id)) {
                return res.status(400).json({ message: 'รหัสตัวเลือกไม่ถูกต้อง' });
            }

            const { rowCount } = await database.query(
                'DELETE FROM plan_preference_options WHERE id = $1',
                [id],
            );
            if (rowCount === 0) {
                return res.status(404).json({ message: 'ไม่พบตัวเลือกนี้' });
            }
            res.json({ message: 'ลบตัวเลือกเรียบร้อยแล้ว' });
        } catch (err) {
            console.error('[preferenceController] delete error:', err);
            res.status(500).json({ message: 'เกิดข้อผิดพลาดในการลบตัวเลือก' });
        }
    };

    // แอปมือถือ: ตัวเลือกที่ใช้งานอยู่ แปลภาษาตาม Accept-Language
    const getPlanOptions = async (req, res) => {
        const language = requestLanguage(req);
        try {
            const { rows } = await database.query(
                `SELECT type, key, label_th, label_en, icon
                 FROM plan_preference_options
                 WHERE is_active = TRUE
                 ORDER BY type, sort_order ASC, id ASC`,
            );

            const interests = [];
            const transportModes = [];
            for (const row of rows) {
                const label = language === 'en'
                    ? (row.label_en || row.label_th)
                    : (row.label_th || row.label_en);
                const item = { key: row.key, label };
                if (row.type === 'transport_mode') {
                    item.icon = row.icon || row.key;
                    transportModes.push(item);
                } else {
                    interests.push(item);
                }
            }

            addLanguageVaryHeader(res);
            res.json({ data: { interests, transportModes }, language });
        } catch (err) {
            console.error('[preferenceController] plan options error:', err);
            res.status(500).json({
                message: language === 'en'
                    ? 'Unable to load plan options'
                    : 'เกิดข้อผิดพลาดในการดึงตัวเลือกแผนเที่ยว',
            });
        }
    };

    return {
        listPreferences,
        createPreference,
        updatePreference,
        deletePreference,
        getPlanOptions,
    };
};

const {
    listPreferences,
    createPreference,
    updatePreference,
    deletePreference,
    getPlanOptions,
} = createPreferenceControllers(pool);

module.exports = {
    createPreferenceControllers,
    listPreferences,
    createPreference,
    updatePreference,
    deletePreference,
    getPlanOptions,
};
