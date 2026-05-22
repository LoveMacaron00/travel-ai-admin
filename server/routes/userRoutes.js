const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { requireAdminAuth } = require('../middleware/adminAuth');

router.get('/check-banned', userController.checkBanStatus);
router.post('/register', userController.registerUser);
router.post('/login', userController.loginUser);
router.get('/', requireAdminAuth, userController.getAllUsers);
router.get('/:id', requireAdminAuth, userController.getUserById);
router.put('/:id/ban', requireAdminAuth, userController.toggleBanUser);

module.exports = router;
