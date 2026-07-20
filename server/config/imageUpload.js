const multer = require('multer');

const supportedMimeTypes = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/octet-stream',
]);

const imageUpload = multer({
    // รับภาพไว้ใน memory เพื่อวิเคราะห์ก่อน และบันทึกถาวรเมื่อ AI ตอบสำเร็จเท่านั้น
    // magic bytes จะถูกตรวจซ้ำใน imageAnalysisHelper ก่อนส่งต่อ provider/จัดเก็บ
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
