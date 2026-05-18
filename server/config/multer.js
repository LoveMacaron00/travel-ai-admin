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
        const allowed = /jpeg|jpg|png|gif|webp/;
        const extValid = allowed.test(path.extname(file.originalname).toLowerCase());
        const mimeValid = allowed.test(file.mimetype.split('/')[1]);

        if (extValid && mimeValid) {
            cb(null, true);
        } else {
            cb(new Error('อนุญาตเฉพาะไฟล์รูปภาพเท่านั้น'));
        }
    }
});

module.exports = upload;
