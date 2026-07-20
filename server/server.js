// server/server.js

const path = require('path');
const { config, warnAboutMissingEnvironment } = require('./config/env');
const { ensureAppUsageSchema } = require('./config/appUsageSchema');
const { ensureChatMediaSchema } = require('./config/chatMediaSchema');

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const { requireAdminAuth } = require('./middleware/adminAuth');
const { secureUploads } = require('./middleware/secureUploads');


const app = express();

// Middleware ส่วนกลางต้องมาก่อน routes เพื่อให้ policy เหมือนกันทุก endpoint
app.use(morgan('dev'));
app.use(cors({
    origin: config.allowedOrigins,
    credentials: true
}));

app.use(compression());
app.use(express.json({ limit: '2mb' }));

// ไฟล์ทั่วไป เช่น รูปโปรไฟล์/สถานที่ ผ่าน auth ก่อน express.static
// ส่วนรูป AI Camera อยู่ในโฟลเดอร์ย่อยแต่ส่งผ่าน chat endpoint ที่ตรวจ ownership
const uploadsDir = path.join(__dirname, 'uploads');

app.use('/uploads', secureUploads, express.static(uploadsDir));


warnAboutMissingEnvironment();

// แบ่ง route ตามผู้ใช้: admin, mobile public และ mobile ที่ต้อง login
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
const mobileRoutes = require('./routes/mobileRoutes');
const activityRoutes = require('./routes/activityRoutes');

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
app.use('/api/mobile', mobileRoutes);
app.use('/api/activity', activityRoutes);

app.get('/', (req, res) => res.send('Smart Travel API กำลังทำงาน'));

// แปลง error จาก middleware (โดยเฉพาะ Multer) เป็น JSON รูปเดียวกัน
app.use((err, req, res, next) => {
    if (err?.name === 'MulterError') return res.status(400).json({ message: err.message });
    if (err) return res.status(400).json({ message: err.message || 'คำขอไม่ถูกต้อง' });
    next();
});

const startServer = async () => {
    try {
        await ensureAppUsageSchema();
        await ensureChatMediaSchema();
        return app.listen(config.port, () => {
            console.log(`เซิร์ฟเวอร์กำลังทำงานบนพอร์ต ${config.port}`);
        });
    } catch (error) {
        console.error('[server] เตรียม schema ไม่สำเร็จ:', error);
        process.exitCode = 1;
        return null;
    }
};

if (require.main === module) {
    startServer();
}

module.exports = { app, startServer };
