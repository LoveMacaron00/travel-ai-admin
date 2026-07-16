// server/controllers/feedbackController.js

const pool = require('../config/db');

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
    getAllFeedback,
    updateFeedback
};
