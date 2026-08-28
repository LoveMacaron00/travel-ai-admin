// server/controllers/feedbackController.js

const pool = require('../config/db');

// สร้าง feedback ใหม่จากผู้ใช้
const createFeedback = async (req, res) => {
    try {
        const { message } = req.body;
        const userId = req.user?.id;

        if (!message || message.trim() === '') {
            return res.status(400).json({ message: 'กรุณากรอกข้อความ feedback' });
        }

        const { rows } = await pool.query(
            `INSERT INTO feedback (user_id, message, status, created_at)
             VALUES ($1, $2, 'pending', NOW())
             RETURNING id, user_id, message, status, created_at`,
            [userId, message.trim()]
        );

        res.status(201).json(rows[0]);
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการสร้าง feedback:', err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดภายใน feedbackController - createFeedback' });
    }
};

// ดึง feedback ของ user คนนั้นๆ สำหรับ mobile app
const getUserFeedback = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { rows } = await pool.query(
            `SELECT id, message, status, admin_reply, created_at
             FROM feedback
             WHERE user_id = $1
             ORDER BY created_at DESC`,
            [userId]
        );
        res.json(rows);
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการดึงข้อมูล feedback ของ user:', err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดภายใน feedbackController - getUserFeedback' });
    }
};

// ส่งรายการ feedback ทั้งหมดสำหรับหน้าจัดการของ admin
const getAllFeedback = async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT f.id, f.message, f.status, f.admin_reply, f.created_at,
                    u.username, u.email AS user_email
             FROM feedback f
             LEFT JOIN users u ON f.user_id = u.id
             ORDER BY f.created_at DESC`
        );
        res.json(rows);
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการดึงข้อมูล feedback:', err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดภายใน feedbackController - getAllFeedback' });
    }
};

// อัปเดตสถานะหรือข้อความตอบกลับของ feedback รายการหนึ่ง
const updateFeedback = async (req, res) => {
    try {
        const { status, admin_reply } = req.body;
        const feedbackId = parseInt(req.params.id, 10);

        const { rows } = await pool.query(
            `UPDATE feedback
             SET status = $1, admin_reply = $2
             WHERE id = $3
             RETURNING id, user_id, message, status, admin_reply, created_at`,
            [status, admin_reply, feedbackId]
        );
        const feedback = rows[0] || null;

        if (!feedback) {
            return res.status(404).json({ message: 'ไม่พบ feedback' });
        }
        res.json(feedback);
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการอัปเดต feedback:', err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดภายใน feedbackController - updateFeedback' });
    }
};

module.exports = {
    createFeedback,
    getUserFeedback,
    getAllFeedback,
    updateFeedback
};
