// server/routes/userRoutes.js

const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { requireAdminAuth } = require('../middleware/adminAuth');
const { requireUserAuth } = require('../middleware/userAuth');
const upload = require('../config/multer');

const { loginLimiter } = require('../middleware/rateLimiter');

// POST /api/users/register — สมัครสมาชิกใหม่ (มี rate limit กันสแปม)
router.post('/register', loginLimiter, userController.registerUser);
// POST /api/users/login — เข้าสู่ระบบผู้ใช้แอป ได้ JWT token (มี rate limit)
router.post('/login', loginLimiter, userController.loginUser);
// GET /api/users — รายชื่อผู้ใช้ทั้งหมด (เฉพาะแอดมิน, หน้า Dashboard)
router.get('/', requireAdminAuth, userController.getAllUsers);
// PUT /api/users/:id/ban — สลับสถานะ ban/unban ผู้ใช้ (เฉพาะแอดมิน)
router.put('/:id/ban', requireAdminAuth, userController.toggleBanUser);
// PUT /api/users/profile — แก้โปรไฟล์ตัวเอง (ชื่อผู้ใช้ / interests / รูป)
router.put('/profile', requireUserAuth, userController.updateUserProfile);
// POST /api/users/profile/upload-image — อัปโหลดรูปโปรไฟล์ (multipart)
router.post('/profile/upload-image', requireUserAuth, upload.single('image'), userController.uploadProfileImage);

module.exports = router;
