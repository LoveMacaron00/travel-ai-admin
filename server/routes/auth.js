// server/routes/auth.js

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

const { loginLimiter } = require('../middleware/rateLimiter');

// POST /api/auth/login - เข้าสู่ระบบแอดมิน
router.post('/login', loginLimiter, authController.login);

module.exports = router;
