// Routes: Destination (เส้นทางสถานที่ท่องเที่ยว)
// กำหนดเส้นทาง API สำหรับ CRUD สถานที่

const express = require('express');
const router = express.Router();
const destinationController = require('../controllers/destinationController');

// GET    /api/destinations     - ดึงรายการสถานที่ทั้งหมด (รองรับตัวกรอง)
// GET    /api/destinations/:id - ดึงข้อมูลสถานที่ตาม ID
// POST   /api/destinations     - สร้างสถานที่ใหม่
// PUT    /api/destinations/:id - อัปเดตข้อมูลสถานที่
// DELETE /api/destinations/:id - ลบสถานที่

router.get('/', destinationController.getAllDestinations);
router.get('/:id', destinationController.getDestinationById);
router.post('/', destinationController.createDestination);
router.put('/:id', destinationController.updateDestination);
router.delete('/:id', destinationController.deleteDestination);

module.exports = router;
