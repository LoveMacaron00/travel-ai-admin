// server/middleware/rateLimiter.js

const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 นาที
    max: 10, // จำกัดคำขอเข้าสู่ระบบของแต่ละ IP ไว้ที่ 10 ครั้งต่อช่วงเวลา
    message: {
        message: 'คุณได้พยายามเข้าสู่ระบบมากเกินไป กรุณาลองใหม่ในอีก 15 นาที'
    },
    standardHeaders: true, // ส่งข้อมูลขีดจำกัดคำขอผ่านเฮดเดอร์ `RateLimit-*`
    legacyHeaders: false, // ปิดใช้งานเฮดเดอร์ `X-RateLimit-*`
});

module.exports = {
    loginLimiter
};
