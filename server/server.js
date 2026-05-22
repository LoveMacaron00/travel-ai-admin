const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const morgan = require('morgan');
require('./config/env');
const { requireAdminAuth } = require('./middleware/adminAuth');

const app = express();

// ตั้งค่า Middleware
app.use(morgan('dev'));
app.use(cors());
app.use(compression());
// เพิ่มขนาดของ JSON payload ที่รับได้สูงสุดเป็น 20MB
app.use(express.json({ limit: '20mb' }));

// ตั้งค่าเส้นทางสำหรับไฟล์อัปโหลด
const uploadsDir = path.join(__dirname, 'uploads');
app.use('/uploads', express.static(uploadsDir));

// เชื่อมต่อ Routes ทั้งหมด
const authRoutes = require('./routes/auth');
const destinationRoutes = require('./routes/destinationRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const tatRoutes = require('./routes/tat');
const userRoutes = require('./routes/userRoutes');
const feedbackRoutes = require('./routes/feedbackRoutes');

app.use('/api/auth', authRoutes);            // เส้นทางการยืนยันตัวตน
app.use('/api/destinations', requireAdminAuth, destinationRoutes); // เส้นทาง CRUD สถานที่
app.use('/api/analytics', requireAdminAuth, analyticsRoutes);  // เส้นทางสถิติภาพรวม
app.use('/api/upload', requireAdminAuth, uploadRoutes);        // เส้นทางอัปโหลดรูปภาพ
app.use('/api/v2', requireAdminAuth, tatRoutes);               // เส้นทาง TAT API ภายนอก
app.use('/api/users', userRoutes);           // เส้นทางจัดการผู้ใช้
app.use('/api/feedback', requireAdminAuth, feedbackRoutes);   // เส้นทางจัดการ feedback

// ตรวจสอบสถานะ API
app.get('/', (req, res) => {
    res.send('Smart Travel Admin API กำลังทำงาน');
});

app.use((err, req, res, next) => {
    if (err && err.name === 'MulterError') {
        return res.status(400).json({ message: err.message });
    }

    if (err) {
        return res.status(400).json({ message: err.message || 'คำขอไม่ถูกต้อง' });
    }

    next();
});

// เริ่มต้น Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`เซิร์ฟเวอร์กำลังทำงานบนพอร์ต ${PORT}`);
});
