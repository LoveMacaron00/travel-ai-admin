const express = require('express');
const router = express.Router();
const upload = require('../config/multer');
const uploadController = require('../controllers/uploadController');

// POST /api/upload - อัปโหลดรูปภาพหลายรูป (สูงสุด 10 รูป)
router.post('/', upload.array('images', 10), uploadController.uploadImages);

module.exports = router;
