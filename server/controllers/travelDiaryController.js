const pool = require('../config/db');
const { resolveTatLanguage } = require('../utils/tatLanguage');
const travelDiaryRepository = require('../repositories/travelDiaryRepository');
const { parseEntry, stringValue } = require('../validators/travelDiaryValidator');

const requestLanguage = (req) => resolveTatLanguage(
    typeof req.get === 'function'
        ? req.get('Accept-Language')
        : req.headers?.['accept-language'],
);

const createTravelDiaryController = (database) => {
    const getEntries = async (req, res) => {
        const language = requestLanguage(req);
        try {
            const rows = await travelDiaryRepository.findEntriesByUser(
                req.user.id,
                language,
                database,
            );
            res.vary('Accept-Language');
            return res.json({ data: rows });
        } catch (error) {
            console.error('[travelDiaryController] getEntries:', error.message);
            return res.status(500).json({ message: 'ไม่สามารถโหลดบันทึกการเดินทางได้' });
        }
    };

    const upsertEntry = async (req, res) => {
        let entry;
        try {
            entry = parseEntry(req.body);
        } catch {
            return res.status(400).json({ message: 'ข้อมูลบันทึกการเดินทางไม่ถูกต้อง' });
        }

        try {
            const saved = await travelDiaryRepository.upsertEntry(req.user.id, entry, database);
            return res.status(200).json({ entry: saved });
        } catch (error) {
            if (error.code === '23503') {
                return res.status(400).json({ message: 'ไม่พบสถานที่ที่อ้างอิง' });
            }
            console.error('[travelDiaryController] upsertEntry:', error.message);
            return res.status(500).json({ message: 'ไม่สามารถบันทึกการเดินทางได้' });
        }
    };

    const deleteEntry = async (req, res) => {
        const externalId = stringValue(req.params.externalId, 100);
        if (!externalId) return res.status(400).json({ message: 'รหัสบันทึกไม่ถูกต้อง' });
        try {
            const rowCount = await travelDiaryRepository.deleteEntry(
                req.user.id,
                externalId,
                database,
            );
            if (rowCount === 0) {
                return res.status(404).json({ message: 'ไม่พบบันทึกการเดินทาง' });
            }
            return res.json({ deleted: true });
        } catch (error) {
            console.error('[travelDiaryController] deleteEntry:', error.message);
            return res.status(500).json({ message: 'ไม่สามารถลบบันทึกการเดินทางได้' });
        }
    };

    const uploadImage = (req, res) => {
        if (!req.file) {
            return res.status(400).json({ message: 'ไม่พบไฟล์ที่อัปโหลด' });
        }
        const url = `/uploads/${req.file.filename}`;
        // รองรับทั้ง {url} และ {data:{url}} เพื่อให้ client รุ่นเก่า/ใหม่ใช้งานได้
        return res.json({ url, data: { url } });
    };

    return { getEntries, upsertEntry, deleteEntry, uploadImage };
};

module.exports = {
    createTravelDiaryController,
    ...createTravelDiaryController(pool),
};
