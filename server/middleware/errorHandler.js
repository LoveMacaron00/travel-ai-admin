// server/middleware/errorHandler.js
// แปลง error จาก middleware (โดยเฉพาะ Multer) เป็น JSON รูปเดียวกัน
// พฤติกรรมเดิมจาก server.js — ย้ายมาอยู่ตรงนี้เพื่อให้ทดสอบและ reuse ได้
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, _req, res, _next) => {
  res.status(400).json({ message: err.message || 'คำขอไม่ถูกต้อง' });
};

module.exports = { errorHandler };
