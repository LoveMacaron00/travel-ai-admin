const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { USER_JWT_SECRET } = require('../config/env');

const PUBLIC_COLUMNS = 'id, email, username, profile_image_url, interests, is_private_location, is_banned, created_at';

const getAllUsers = async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY created_at DESC`
        );
        const users = rows;

        res.status(200).json(users);
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการดึงข้อมูล users:', err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดภายใน userController - getAllUsers' });
    }
};

const getUserById = async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`,
            [parseInt(req.params.id, 10)]
        );
        const user = rows[0] || null;

        if (!user) {
            return res.status(404).json({ message: 'ไม่พบผู้ใช้' });
        }

        res.status(200).json(user);
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการดึงข้อมูล user:', err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดภายใน userController - getUserById' });
    }
};

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

        const { rows: existingUserRows } = await query(
            `SELECT ${PUBLIC_COLUMNS} FROM users WHERE email = $1`,
            [email]
        );
        const existingUser = existingUserRows[0] || null;

        if (existingUser) {
            return res.status(409).json({
                message: 'อีเมลนี้ถูกใช้งานแล้ว'
            });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const { rows: newUserRows } = await query(
            `INSERT INTO users (email, hash_password, username)
             VALUES ($1, $2, $3)
             RETURNING ${PUBLIC_COLUMNS}`,
            [email, passwordHash, null]
        );
        const newUser = newUserRows[0];

        const token = jwt.sign(
            { id: newUser.id, email: newUser.email },
            USER_JWT_SECRET,
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

const loginUser = async (req, res) => {
    try {
        const email = req.body.email?.trim().toLowerCase();
        const password = req.body.password;

        if (!email || !password) {
            return res.status(400).json({
                message: 'จำเป็นต้องมี email และ password'
            });
        }

        const { rows } = await query(
            `SELECT ${PUBLIC_COLUMNS}, hash_password FROM users WHERE email = $1`,
            [email]
        );
        const user = rows[0] || null;

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
            USER_JWT_SECRET,
            { expiresIn: '30d' }
        );

        const { hash_password, ...safeUser } = user;

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

const checkBanStatus = async (req, res) => {
    try {
        const email = req.query.email?.trim().toLowerCase();

        if (!email) {
            return res.status(400).json({
                message: 'จำเป็นต้องมี email'
            });
        }

        const { rows } = await query(
            `SELECT ${PUBLIC_COLUMNS} FROM users WHERE email = $1`,
            [email]
        );
        const user = rows[0] || null;

        if (!user) {
            return res.status(404).json({
                message: 'ไม่พบผู้ใช้ในฐานข้อมูล',
                is_banned: false,
                is_registered: false
            });
        }

        res.status(200).json({
            is_registered: true,
            is_banned: user.is_banned,
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                interests: user.interests
            }
        });
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการ check ban status user:', err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดภายใน userController - checkBanStatus' });
    }
};

const toggleBanUser = async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        const { rows: userRows } = await query(
            'SELECT is_banned FROM users WHERE id = $1',
            [userId]
        );

        if (userRows.length === 0) {
            return res.status(404).json({ message: 'ไม่พบผู้ใช้' });
        }

        const newBanStatus = !userRows[0].is_banned;
        const { rows } = await query(
            `UPDATE users SET is_banned = $1 WHERE id = $2
             RETURNING ${PUBLIC_COLUMNS}`,
            [newBanStatus, userId]
        );
        const user = rows[0] || null;

        res.status(200).json({
            message: 'อัปเดตสถานะการแบนผู้ใช้สำเร็จ',
            user
        });
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการ toggle ban status:', err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดภายใน userController - toggleBanUser' });
    }
};

const updateUserProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const { username, interests, is_private_location } = req.body;

        const updates = [];
        const values = [];
        let index = 1;

        if (username !== undefined) {
            updates.push(`username = $${index++}`);
            values.push(username);
        }
        if (interests !== undefined) {
            updates.push(`interests = $${index++}`);
            values.push(JSON.stringify(Array.isArray(interests) ? interests : []));
        }
        if (is_private_location !== undefined) {
            updates.push(`is_private_location = $${index++}`);
            values.push(is_private_location === true);
        }
        if (req.body.profile_image_url !== undefined) {
            updates.push(`profile_image_url = $${index++}`);
            values.push(req.body.profile_image_url);
        }

        if (updates.length === 0) {
            return res.status(400).json({ message: 'ไม่มีข้อมูลที่ต้องการอัปเดต' });
        }

        values.push(userId);
        const { rows } = await query(
            `UPDATE users 
             SET ${updates.join(', ')} 
             WHERE id = $${index} 
             RETURNING ${PUBLIC_COLUMNS}`,
            values
        );

        const updatedUser = rows[0] || null;
        if (!updatedUser) {
            return res.status(404).json({ message: 'ไม่พบผู้ใช้' });
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

const uploadProfileImage = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'ไม่พบไฟล์รูปภาพที่อัปโหลด' });
        }

        const userId = req.user.id;
        const imageUrl = `/uploads/${req.file.filename}`;

        const { rows } = await query(
            `UPDATE users SET profile_image_url = $1 WHERE id = $2 RETURNING ${PUBLIC_COLUMNS}`,
            [imageUrl, userId]
        );

        const updatedUser = rows[0] || null;
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
    getUserById,
    registerUser,
    loginUser,
    checkBanStatus,
    toggleBanUser,
    updateUserProfile,
    uploadProfileImage
};
