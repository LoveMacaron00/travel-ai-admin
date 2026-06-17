// POST /api/admin/embed/bulk       — embed ทุก approved ที่ยังไม่มี vector
// POST /api/admin/embed/:id        — re-embed destination เดียว
// POST /api/admin/sync/tat         — trigger TAT sync
// POST /api/admin/places/:id/approve — approve user submission + embed

const { embedDestination, bulkEmbedMissing } = require('../services/embedService');
const { syncAllTATPlaces, syncOneTATPlace }   = require('../services/tatSyncService');
const AdminEmbedModel = require('../models/adminEmbedModel');

// POST /api/admin/embed/bulk
const bulkEmbed = async (req, res) => {
    try {
        res.json({ message: 'bulk embed เริ่มทำงาน (background)' });
        // รัน background ไม่ block response
        bulkEmbedMissing().catch(err =>
            console.error('[adminEmbed] bulkEmbedMissing error:', err.message)
        );
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// POST /api/admin/embed/:id
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
const syncTAT = async (req, res) => {
    try {
        const { province, keyword } = req.body;
        res.json({ message: 'TAT sync เริ่มทำงาน (background)' });
        syncAllTATPlaces({ province, keyword }).catch(err =>
            console.error('[adminEmbed] syncTAT error:', err.message)
        );
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// POST /api/admin/sync/tat/:tatPlaceId
const syncOneTAT = async (req, res) => {
    try {
        const row = await syncOneTATPlace(req.params.tatPlaceId);
        res.json({ message: 'sync และ embed สำเร็จ', id: row.id });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// POST /api/admin/places/:id/approve
const approvePlace = async (req, res) => {
    try {
        const placeId = parseInt(req.params.id);
        const adminId = req.admin?.id;

        const approvedPlace = await AdminEmbedModel.approvePlace(placeId, adminId);

        if (!approvedPlace) {
            return res.status(404).json({ message: 'ไม่พบ destination หรือไม่ได้อยู่ในสถานะ pending' });
        }

        // embed หลัง approve ทันที (background)
        embedDestination(placeId).catch(err =>
            console.error(`[adminEmbed] embed after approve ${placeId}:`, err.message)
        );

        res.json({ message: `อนุมัติ "${approvedPlace.name}" สำเร็จ กำลัง embed...`, id: placeId });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// POST /api/admin/places/:id/reject
const rejectPlace = async (req, res) => {
    try {
        const { reason } = req.body;
        const rejectedPlace = await AdminEmbedModel.rejectPlace(parseInt(req.params.id));
        
        if (!rejectedPlace) return res.status(404).json({ message: 'ไม่พบ destination' });
        
        res.json({ message: `ปฏิเสธ "${rejectedPlace.name}" สำเร็จ`, reason });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

module.exports = { bulkEmbed, embedOne, syncTAT, syncOneTAT, approvePlace, rejectPlace };