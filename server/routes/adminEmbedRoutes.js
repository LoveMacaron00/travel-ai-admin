// server/routes/adminEmbedRoutes.js

const express = require('express');
const router  = express.Router();
const {
    bulkEmbed, embedOne, syncTAT, syncOneTAT
} = require('../controllers/adminEmbedController');
const { requireAdminAuth } = require('../middleware/adminAuth');

// ทุก route ใน admin ต้อง pass adminAuth

// POST /api/admin/embed/bulk            — embed ทุก approved ที่ยังไม่มี vector
// POST /api/admin/embed/:id             — re-embed destination เดียว
// POST /api/admin/sync/tat              — TAT sync ทั้งหมด (background)
// POST /api/admin/sync/tat/:tatPlaceId  — sync TAT place เดียว

router.post('/embed/bulk',              requireAdminAuth, bulkEmbed);
router.post('/embed/:id',               requireAdminAuth, embedOne);
router.post('/sync/tat',                requireAdminAuth, syncTAT);
router.post('/sync/tat/:tatPlaceId',    requireAdminAuth, syncOneTAT);

module.exports = router;
