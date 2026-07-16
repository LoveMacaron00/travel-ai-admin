const multer = require('multer');

const supportedMimeTypes = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/octet-stream',
]);

const imageUpload = multer({
    // Image scan ไม่ต้องเก็บไฟล์ต้นฉบับ จึงรับไว้ใน memory และจำกัดขนาด
    // magic bytes จะถูกตรวจซ้ำใน imageAnalysisHelper ก่อนส่งต่อ provider
    storage: multer.memoryStorage(),
    limits: {
        files: 1,
        fileSize: 2 * 1024 * 1024,
    },
    fileFilter: (req, file, callback) => {
        if (!supportedMimeTypes.has(String(file.mimetype).toLowerCase())) {
            return callback(new Error('รองรับเฉพาะรูป JPEG, PNG หรือ WebP'));
        }
        callback(null, true);
    },
});

module.exports = imageUpload;
