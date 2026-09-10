// server/controllers/preferenceController.js
// จัดการตัวเลือกของหน้าสร้างแผนเที่ยวในแอปมือถือ:
//   - interest       : "คุณชอบอะไร" (อาหาร, คาเฟ่, ธรรมชาติ, ...)
//   - transport_mode : "คุณเดินทางแบบใดได้บ้าง" (รถยนต์, เดิน, ...)
// Admin CRUD ผ่าน /api/preferences และแอปมือถืออ่านค่าที่ใช้งานผ่าน /api/mobile/plan-options

const pool = require('../config/db');
const { resolveTatLanguage } = require('../utils/tatLanguage');
const preferenceRepository = require('../repositories/preferenceRepository');
const {
    ALLOWED_TYPES,
    normalizePreferenceInput: normalizeInput,
} = require('../validators/preferenceValidator');

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

// สร้าง controller สำหรับจัดการตัวเลือก โดยรับ database เพื่อทดสอบหรือสลับ dependency ได้
const createPreferenceControllers = (database) => {
    // Admin: รายการตัวเลือกทั้งหมด (รวมที่ปิดใช้งาน) เรียงตามประเภทและลำดับ
    const listPreferences = async (req, res) => {
        try {
            const type = req.query.type;
            if (type && !ALLOWED_TYPES.has(type)) {
                return res.status(400).json({ message: 'ประเภทตัวเลือกไม่ถูกต้อง' });
            }

            const rows = await preferenceRepository.listAll(type || null, database);
            res.json({ data: rows });
        } catch (err) {
            console.error('[preferenceController] list error:', err);
            res.status(500).json({ message: 'เกิดข้อผิดพลาดในการดึงตัวเลือก' });
        }
    };

    // Admin: เพิ่มตัวเลือกใหม่ (ไม่ระบุลำดับจะเรียงต่อท้ายหมวดหมู่อัตโนมัติ)
    const createPreference = async (req, res) => {
        try {
            const { type, key, labelTh, labelEn, sortOrder, iconUrl } =
                normalizeInput(req.body);

            let nextOrder = sortOrder;
            if (nextOrder == null) {
                nextOrder = await preferenceRepository.nextSortOrder(type, database);
            }

            const created = await preferenceRepository.createOption(
                { type, key, labelTh, labelEn, iconUrl, sortOrder: nextOrder },
                database,
            );
            res.status(201).json({ data: created });
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

            const { type, key, labelTh, labelEn, sortOrder, iconUrl } =
                normalizeInput(req.body);
            const isActive = req.body.is_active !== false;

            // ไม่ระบุลำดับใหม่ให้คงลำดับเดิม (COALESCE ด้านขวาอ้างอิงค่าก่อนแก้ไข)
            const updated = await preferenceRepository.updateOption(
                id,
                { type, key, labelTh, labelEn, iconUrl, sortOrder, isActive },
                database,
            );
            if (!updated) {
                return res.status(404).json({ message: 'ไม่พบตัวเลือกนี้' });
            }
            res.json({ data: updated });
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

            const rowCount = await preferenceRepository.removeOption(id, database);
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
            const rows = await preferenceRepository.findActive(database);

            const interests = [];
            const transportModes = [];
            for (const row of rows) {
                const label = language === 'en'
                    ? (row.label_en || row.label_th)
                    : (row.label_th || row.label_en);
                const item = { key: row.key, label, icon_url: row.icon_url || null };
                if (row.type === 'transport_mode') {
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
