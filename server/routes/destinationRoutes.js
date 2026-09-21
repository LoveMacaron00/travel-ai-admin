// server/routes/destinationRoutes.js

const express = require('express');
const router = express.Router();
const destinationController = require('../controllers/destinationController');

// หมายเหตุ: auth ใส่ระดับ mount path ใน server.js (app.use('/api/destinations', requireAdminAuth, ...))
// จึงเป็นเส้นทางเฉพาะแอดมินทั้งหมด (หน้าจัดการสถานที่ใน Admin Panel)

// GET /api/destinations - ดึงรายการสถานที่ทั้งหมด (รองรับตัวกรอง)
// GET /api/destinations/:id - ดึงข้อมูลสถานที่ตาม ID
// POST /api/destinations - สร้างสถานที่ใหม่
// PUT /api/destinations/:id - อัปเดตข้อมูลสถานที่
// DELETE /api/destinations/:id - ลบสถานที่

router.get('/', destinationController.getAllDestinations);
router.get('/:id', destinationController.getDestinationById);
router.post('/', destinationController.createDestination);
router.put('/:id', destinationController.updateDestination);
router.delete('/:id', destinationController.deleteDestination);

module.exports = router;
