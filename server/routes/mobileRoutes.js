// server/routes/mobileRoutes.js

const express = require('express');
const router = express.Router();
const mobileController = require('../controllers/mobileController');
const { proxyImage } = require('../controllers/mediaController');
const { recordDestinationView } = require('../controllers/destinationViewController');
const { requireUserAuth } = require('../middleware/userAuth');
const travelDiaryController = require('../controllers/travelDiaryController');
const preferenceController = require('../controllers/preferenceController');
const feedbackController = require('../controllers/feedbackController');
const upload = require('../config/multer');

// GET /api/mobile/media?url=... — proxy รูปจาก CDN ภายนอก (ตรวจ allow-list)
// ใช้เฉพาะบน Web ที่โดน CORS ตอน fetch รูปข้าม origin
router.get('/media', proxyImage);
// GET /api/mobile/plan-options — ตัวเลือกความสนใจและรูปแบบการเดินทาง
// สำหรับหน้าสร้างแผนเที่ยว (admin จัดการผ่าน /api/preferences)
router.get('/plan-options', preferenceController.getPlanOptions);
// GET /api/mobile/provinces — รายชื่อจังหวัดสำหรับ dropdown ในฟอร์มสร้างแผน
router.get('/provinces', mobileController.getProvinces);
// GET /api/mobile/destinations — รายการสถานที่ท่องเที่ยว (หน้า Home/Map/Plan)
router.get('/destinations', mobileController.getDestinations);
// POST /api/mobile/destinations/:id/view — บันทึกว่าผู้ใช้เปิดดูสถานที่ (analytics)
router.post('/destinations/:id/view', requireUserAuth, recordDestinationView);
// GET /api/mobile/destinations/:id — รายละเอียดสถานที่หนึ่งแห่ง (หน้า Destination Detail)
router.get('/destinations/:id', mobileController.getDestinationDetail);
// GET /api/mobile/diary — บันทึก Smart Diary ทั้งหมดของผู้ใช้
router.get('/diary', requireUserAuth, travelDiaryController.getEntries);
// POST /api/mobile/diary — เพิ่ม/อัปเดต (upsert) บันทึก diary หนึ่งรายการ
router.post('/diary', requireUserAuth, travelDiaryController.upsertEntry);
// DELETE /api/mobile/diary/:externalId — ลบบันทึก diary
router.delete('/diary/:externalId', requireUserAuth, travelDiaryController.deleteEntry);
// POST /api/mobile/diary/upload — อัปโหลดรูปประกอบ diary (multipart) คืน URL รูป
router.post('/diary/upload', requireUserAuth, upload.single('image'), travelDiaryController.uploadImage);
// POST /api/mobile/feedback — ส่ง feedback ของผู้ใช้ถึงทีมงาน
router.post('/feedback', requireUserAuth, feedbackController.createFeedback);
// GET /api/mobile/feedback/my — ประวัติ feedback ที่ผู้ใช้เคยส่ง
router.get('/feedback/my', requireUserAuth, feedbackController.getUserFeedback);

module.exports = router;
