// server/controllers/uploadController.js

// แปลงไฟล์ที่ Multer รับไว้เป็น URL สำหรับบันทึกกับสถานที่
const uploadImages = (req, res) => {
    // ตรวจสอบว่ามีไฟล์ที่อัปโหลดหรือไม่
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: 'ไม่พบไฟล์ที่อัปโหลด' });
    }

    // สร้าง URL สำหรับแต่ละไฟล์ที่อัปโหลดสำเร็จ
    const urls = req.files.map(f => `/uploads/${f.filename}`);
    res.json({ urls });
};

module.exports = {
    uploadImages
};
