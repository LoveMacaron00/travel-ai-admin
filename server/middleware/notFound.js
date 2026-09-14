// server/middleware/notFound.js
// 404 กลาง — route ไหนไม่ตรงให้ตอบ JSON รูปเดียวกับทั้ง API
const notFound = (_req, res, _next) => {
  res.status(404).json({ message: 'ไม่พบเส้นทางที่ร้องขอ' });
};

module.exports = { notFound };
