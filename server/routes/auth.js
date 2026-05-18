// Routes: Auth (เส้นทางการยืนยันตัวตน)
// กำหนดเส้นทาง API สำหรับการเข้าสู่ระบบ

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// POST /api/auth/login - เข้าสู่ระบบแอดมิน
router.post('/login', authController.login);

module.exports = router;
