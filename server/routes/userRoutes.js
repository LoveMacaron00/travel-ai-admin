// server/routes/userRoutes.js

const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { requireAdminAuth } = require('../middleware/adminAuth');
const { requireUserAuth } = require('../middleware/userAuth');
const upload = require('../config/multer');

const { loginLimiter } = require('../middleware/rateLimiter');

router.get('/check-banned', userController.checkBanStatus);
router.post('/register', loginLimiter, userController.registerUser);
router.post('/login', loginLimiter, userController.loginUser);
router.get('/', requireAdminAuth, userController.getAllUsers);
router.get('/:id', requireAdminAuth, userController.getUserById);
router.put('/:id/ban', requireAdminAuth, userController.toggleBanUser);
router.put('/profile', requireUserAuth, userController.updateUserProfile);
router.post('/profile/upload-image', requireUserAuth, upload.single('image'), userController.uploadProfileImage);

module.exports = router;
