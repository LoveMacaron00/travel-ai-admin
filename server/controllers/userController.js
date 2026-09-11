// server/controllers/userController.js

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const userRepository = require('../repositories/userRepository');
const { userJwtSecret } = require('../config/jwtSecrets');

// ส่งรายชื่อผู้ใช้สำหรับหน้าจัดการของ admin
const getAllUsers = async (req, res) => {
    try {
        const rows = await userRepository.findAll();
        res.status(200).json(rows);
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการดึงข้อมูล users:', err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดภายใน userController - getAllUsers' });
    }
};

// สมัครบัญชีผู้ใช้ใหม่และออก JWT สำหรับแอปมือถือ
const registerUser = async (req, res) => {
    try {
        const email = req.body.email?.trim().toLowerCase();
        const password = req.body.password;

        if (!email || !password) {
            return res.status(400).json({
                message: 'จำเป็นต้องมี email และ password'
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                message: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'
            });
        }

        const existingUser = await userRepository.findByEmail(email);

        if (existingUser) {
            return res.status(409).json({
                message: 'อีเมลนี้ถูกใช้งานแล้ว'
            });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const newUser = await userRepository.createUser({ email, passwordHash });

        const token = jwt.sign(
            { id: newUser.id, email: newUser.email },
            userJwtSecret,
            { expiresIn: '30d' }
        );

        res.status(201).json({
            message: 'สมัครสมาชิกสำเร็จ',
            user: newUser,
            token
        });
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการสมัครสมาชิก:', err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดภายใน userController - registerUser' });
    }
};

// ตรวจ credential ของผู้ใช้และออก JWT เมื่อเข้าสู่ระบบสำเร็จ
const loginUser = async (req, res) => {
    try {
        const email = req.body.email?.trim().toLowerCase();
        const password = req.body.password;

        if (!email || !password) {
            return res.status(400).json({
                message: 'จำเป็นต้องมี email และ password'
            });
        }

        const user = await userRepository.findByEmailWithPassword(email);

        if (!user) {
            return res.status(401).json({
                message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
            });
        }

        if (!user.hash_password) {
            return res.status(400).json({
                message: 'บัญชีนี้ยังไม่ได้ตั้งค่ารหัสผ่านสำหรับระบบใหม่'
            });
        }

        const isPasswordValid = await bcrypt.compare(password, user.hash_password);

        if (!isPasswordValid) {
            return res.status(401).json({
                message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
            });
        }

        if (user.is_banned) {
            return res.status(403).json({
                message: 'บัญชีนี้ถูกระงับการใช้งาน',
                is_banned: true
            });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email },
            userJwtSecret,
            { expiresIn: '30d' }
        );

        const safeUser = { ...user };
        delete safeUser.hash_password;

        res.status(200).json({
            message: 'เข้าสู่ระบบสำเร็จ',
            user: safeUser,
            token
        });
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการเข้าสู่ระบบผู้ใช้:', err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดภายใน userController - loginUser' });
    }
};

// สลับสถานะระงับบัญชีผู้ใช้ตาม id ที่ admin ระบุ
const toggleBanUser = async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);

        const banStatus = await userRepository.findBanStatus(userId);

        if (banStatus === null) {
            return res.status(404).json({ message: 'ไม่พบผู้ใช้' });
        }

        const user = await userRepository.setBanStatus(userId, !banStatus);

        if (!user) {
            return res.status(404).json({ message: 'ไม่พบผู้ใช้' });
        }

        res.status(200).json({
            message: 'อัปเดตสถานะการแบนผู้ใช้สำเร็จ',
            user
        });
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการ toggle ban status:', err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดภายใน userController - toggleBanUser' });
    }
};

// อัปเดตข้อมูลโปรไฟล์ของผู้ใช้ที่ล็อกอินอยู่
const updateUserProfile = async (req, res) => {
    try {
        const userId = req.user.id;

        if (Object.keys(req.body).length === 0) {
            return res.status(400).json({ message: 'ไม่มีข้อมูลที่ต้องการอัปเดต' });
        }

        const updates = {
            username: req.body.username,
            interests: req.body.interests,
            profile_image_url: req.body.profile_image_url
        };

        const hasKnownField =
            updates.username !== undefined ||
            updates.interests !== undefined ||
            updates.profile_image_url !== undefined;

        if (!hasKnownField) {
            return res.status(404).json({ message: 'ไม่พบผู้ใช้ หรือไม่มีข้อมูลอัปเดต' });
        }

        const updatedUser = await userRepository.updateProfile(userId, updates);

        if (!updatedUser) {
            return res.status(404).json({ message: 'ไม่พบผู้ใช้ หรือไม่มีข้อมูลอัปเดต' });
        }

        res.status(200).json({
            message: 'อัปเดตข้อมูลส่วนตัวสำเร็จ',
            user: updatedUser
        });
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการอัปเดตข้อมูลผู้ใช้:', err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดภายใน userController - updateUserProfile' });
    }
};

// บันทึก URL รูปโปรไฟล์ใหม่ของผู้ใช้ที่ล็อกอินอยู่
const uploadProfileImage = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'ไม่พบไฟล์รูปภาพที่อัปโหลด' });
        }

        const userId = req.user.id;
        const imageUrl = `/uploads/${req.file.filename}`;

        const updatedUser = await userRepository.updateProfileImage(userId, imageUrl);

        if (!updatedUser) {
            return res.status(404).json({ message: 'ไม่พบผู้ใช้' });
        }

        res.status(200).json({
            message: 'อัปโหลดรูปโปรไฟล์สำเร็จ',
            profile_image_url: imageUrl,
            user: updatedUser
        });
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการอัปโหลดรูปโปรไฟล์:', err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดภายใน userController - uploadProfileImage' });
    }
};

module.exports = {
    getAllUsers,
    registerUser,
    loginUser,
    toggleBanUser,
    updateUserProfile,
    uploadProfileImage
};
