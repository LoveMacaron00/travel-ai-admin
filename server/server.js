const express = require('express');
const cors = require('cors');
const compression = require('compression');
const dotenv = require('dotenv');
const path = require('path');
const morgan = require('morgan');

dotenv.config();
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
app.use('/api/destinations', destinationRoutes); // เส้นทาง CRUD สถานที่
app.use('/api/analytics', analyticsRoutes);  // เส้นทางสถิติภาพรวม
app.use('/api/upload', uploadRoutes);        // เส้นทางอัปโหลดรูปภาพ
app.use('/api/v2', tatRoutes);               // เส้นทาง TAT API ภายนอก
app.use('/api/users', userRoutes);           // เส้นทางจัดการผู้ใช้
app.use('/api/feedback', feedbackRoutes);   // เส้นทางจัดการ feedback

// ตรวจสอบสถานะ API
app.get('/', (req, res) => {
    res.send('Smart Travel Admin API กำลังทำงาน');
});

// เริ่มต้น Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`เซิร์ฟเวอร์กำลังทำงานบนพอร์ต ${PORT}`);
});
