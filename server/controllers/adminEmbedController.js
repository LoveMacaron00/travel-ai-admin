// server/controllers/adminEmbedController.js

const { embedDestination } = require('../services/embedHelper');
const {
    syncAllTATPlaces,
    syncOneTATPlace,
    syncMissingTATTranslations,
    startBulkEmbeddingQueue,
} = require('../services/tatSyncService');

// POST /api/admin/embed/bulk
// สั่งสร้าง embedding ให้สถานที่ที่ยังขาดผ่าน admin API
const bulkEmbed = async (req, res) => {
    try {
        const started = startBulkEmbeddingQueue();
        res.status(202).json({
            started,
            message: started
                ? 'เริ่มคิวสร้างข้อมูลค้นหา AI เฉพาะสถานที่ที่ยังไม่มีแล้ว'
                : 'คิวสร้างข้อมูลค้นหา AI กำลังทำงานอยู่',
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// POST /api/admin/embed/:id
// สั่งสร้าง embedding ใหม่ให้สถานที่หนึ่งแห่งผ่าน admin API
const embedOne = async (req, res) => {
    try {
        const ok = await embedDestination(parseInt(req.params.id));
        if (!ok) return res.status(404).json({ message: 'ไม่พบ destination หรือยังไม่ approved' });
        res.json({ message: 'embed สำเร็จ' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// POST /api/admin/sync/tat
// เริ่มงาน sync สถานที่ TAT ทั้งหมดผ่าน admin API
const syncTAT = async (req, res) => {
    try {
        const { province, keyword, placeCategory } = req.body;
        res.status(202).json({ message: 'เริ่มซิงก์ข้อมูล TAT แล้ว ระบบจะเข้าคิวสร้างข้อมูล AI ที่ขาดหลังซิงก์เสร็จ' });
        syncAllTATPlaces({ province, keyword, placeCategory, hydrateDetails: true })
            .then(summary => {
                console.log('[adminEmbed] syncTAT complete:', summary);
                startBulkEmbeddingQueue();
            })
            .catch(err => console.error('[adminEmbed] syncTAT error:', err.message));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// POST /api/admin/sync/tat/:tatPlaceId
// เริ่มงาน sync สถานที่ TAT หนึ่งแห่งผ่าน admin API
const syncOneTAT = async (req, res) => {
    try {
        const row = await syncOneTATPlace(req.params.tatPlaceId);
        let embeddingCreated = false;
        let warning = null;
        try {
            embeddingCreated = await embedDestination(row.id);
            if (!embeddingCreated) {
                warning = 'ซิงก์ข้อมูลสถานที่สำเร็จ แต่สถานที่ยังไม่พร้อมสร้างข้อมูล AI';
            }
        } catch (embeddingError) {
            console.error(`[adminEmbed] single embedding ${row.id} error:`, embeddingError.message);
            warning = 'ซิงก์ข้อมูลสถานที่สำเร็จ แต่สร้างข้อมูล AI ไม่สำเร็จ กรุณาลองใหม่ภายหลัง';
        }
        res.json({
            message: warning || 'ซิงก์ข้อมูลและสร้าง embedding สำเร็จ',
            id: row.id,
            languages: row.languages,
            embeddingCreated,
            ...(warning && { warning }),
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// POST /api/admin/sync/tat/translations
// เริ่มงานเติมคำแปล TAT ที่ขาดผ่าน admin API
const syncTATTranslations = async (_req, res) => {
    try {
        const summary = await syncMissingTATTranslations();
        res.json({ message: 'sync English translations สำเร็จ', ...summary });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

module.exports = {
    bulkEmbed,
    embedOne,
    syncTAT,
    syncOneTAT,
    syncTATTranslations,
};
