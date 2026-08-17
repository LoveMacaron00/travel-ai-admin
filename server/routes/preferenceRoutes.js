// server/routes/preferenceRoutes.js
// Admin CRUD สำหรับตัวเลือกความสนใจและรูปแบบการเดินทาง
// (ตัวเลือกในหน้าสร้างแผนเที่ยวของแอปมือถือ)
// หมายเหตุ: requireAdminAuth ถูกบังคับที่ mount ใน server.js เช่นเดียวกับ destinationRoutes

const express = require('express');
const router = express.Router();
const preferenceController = require('../controllers/preferenceController');

// GET /api/preferences?type=interest|transport_mode — รายการตัวเลือก
router.get('/', preferenceController.listPreferences);
// POST /api/preferences — เพิ่มตัวเลือกใหม่
router.post('/', preferenceController.createPreference);
// PUT /api/preferences/:id — แก้ไขตัวเลือก
router.put('/:id', preferenceController.updatePreference);
// DELETE /api/preferences/:id — ลบตัวเลือก
router.delete('/:id', preferenceController.deletePreference);

module.exports = router;
