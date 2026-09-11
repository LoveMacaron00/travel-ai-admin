const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const preferenceController = require('../controllers/preferenceController');
const { preferencesDir: prefUploadDir } = require('../config/storage');

const iconStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, prefUploadDir),
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase() || '.png';
        const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
        cb(null, name);
    },
});

const iconUpload = multer({
    storage: iconStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (_req, file, cb) => {
        const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
        if (allowedMimes.includes(file.mimetype.toLowerCase())) {
            cb(null, true);
        } else {
            cb(new Error('อนุญาตเฉพาะไฟล์รูปภาพ (.png, .jpg, .jpeg, .webp, .svg)'));
        }
    },
});

// POST /api/preferences/upload-icon — อัปโหลดรูป Icon ตัวเลือก
router.post('/upload-icon', iconUpload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'กรุณาเลือกไฟล์รูปภาพ' });
    }
    const iconUrl = `/uploads/preferences/${req.file.filename}`;
    res.json({ url: iconUrl });
});

// GET /api/preferences?type=interest|transport_mode — รายการตัวเลือก
router.get('/', preferenceController.listPreferences);
// POST /api/preferences — เพิ่มตัวเลือกใหม่
router.post('/', preferenceController.createPreference);
// PUT /api/preferences/:id — แก้ไขตัวเลือก
router.put('/:id', preferenceController.updatePreference);
// DELETE /api/preferences/:id — ลบตัวเลือก
router.delete('/:id', preferenceController.deletePreference);

module.exports = router;
