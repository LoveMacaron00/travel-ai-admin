// การตั้งค่า Multer สำหรับอัปโหลดไฟล์รูปภาพ

const multer = require('multer');
const path = require('path');
const fs = require('fs');

// กำหนดโฟลเดอร์สำหรับเก็บรูปภาพ
const uploadsDir = path.join(__dirname, '..', 'uploads');

// สร้างโฟลเดอร์ uploads หากยังไม่มี
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// ตั้งค่าการจัดเก็บไฟล์
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    }
});

// ตั้งค่า Multer พร้อมการกรองไฟล์
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // จำกัดขนาดไฟล์ 10MB
    fileFilter: (req, file, cb) => {
        const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
        const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

        const ext = path.extname(file.originalname).toLowerCase();
        const mime = file.mimetype.toLowerCase();

        const extValid = allowedExts.includes(ext);
        const mimeValid = allowedMimes.includes(mime);

        if (extValid && mimeValid) {
            cb(null, true);
        } else {
            cb(new Error('อนุญาตเฉพาะไฟล์รูปภาพเท่านั้น (.jpg, .jpeg, .png, .gif, .webp)'));
        }
    }
});

module.exports = upload;
