const express = require('express');
const cors = require('cors');
const compression = require('compression'); // ใช้สำหรับบีบอัดข้อมูล
const path = require('path');
const morgan = require('morgan'); // ใช้สำหรับบันทึก Log การทำงานของ HTTP Request
const { requireAdminAuth } = require('./middleware/adminAuth');
require("dotenv").config();


const app = express();

// Middleware
app.use(morgan('dev'));
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '20mb' }));

// uploads รูป
const uploadsDir = path.join(__dirname, 'uploads');
app.use('/uploads', express.static(uploadsDir));

// error handler
app.use((err, req, res, next) => {
    if (err?.name === 'MulterError') return res.status(400).json({ message: err.message });
    if (err) return res.status(400).json({ message: err.message || 'คำขอไม่ถูกต้อง' });
    next();
});

// ตรวจ required keys ตอน startup warn ถ้าขาด
const REQUIRED = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'TATDATAAPI'];
for (const key of REQUIRED) {
    if (!process.env[key]) console.warn(`[env] ${key} ไม่ได้ตั้งค่าใน .env`);
}

// Routes
const authRoutes = require('./routes/auth');
const destinationRoutes = require('./routes/destinationRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const tatRoutes = require('./routes/tat');
const userRoutes = require('./routes/userRoutes');
const feedbackRoutes = require('./routes/feedbackRoutes');
const tripRoutes = require('./routes/tripRoutes');
const chatRoutes = require('./routes/chatRoutes');
const adminEmbedRoutes = require('./routes/adminEmbedRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/destinations', requireAdminAuth, destinationRoutes);
app.use('/api/analytics', requireAdminAuth, analyticsRoutes);
app.use('/api/upload', requireAdminAuth, uploadRoutes);
app.use('/api/v2', requireAdminAuth, tatRoutes);
app.use('/api/users', userRoutes);
app.use('/api/feedback', requireAdminAuth, feedbackRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/admin', adminEmbedRoutes);

app.get('/', (req, res) => res.send('Smart Travel API กำลังทำงาน'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`เซิร์ฟเวอร์กำลังทำงานบนพอร์ต ${PORT}`);
});
