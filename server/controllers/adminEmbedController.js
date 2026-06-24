// POST /api/admin/embed/bulk       — embed ทุก approved ที่ยังไม่มี vector
// POST /api/admin/embed/:id        — re-embed destination เดียว
// POST /api/admin/sync/tat         — trigger TAT sync

const { embedDestination, bulkEmbedMissing } = require('../services/embedService');
const { syncAllTATPlaces, syncOneTATPlace }   = require('../services/tatSyncService');

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

module.exports = { bulkEmbed, embedOne, syncTAT, syncOneTAT };