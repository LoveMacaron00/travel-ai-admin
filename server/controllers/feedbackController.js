// server/controllers/feedbackController.js

const feedbackRepository = require('../repositories/feedbackRepository');

// สร้าง feedback ใหม่จากผู้ใช้
const createFeedback = async (req, res) => {
    try {
        const { message } = req.body;
        const userId = req.user?.id;

        if (!message || message.trim() === '') {
            return res.status(400).json({ message: 'กรุณากรอกข้อความ feedback' });
        }

        const feedback = await feedbackRepository.createFeedback({
            userId,
            message: message.trim(),
        });

        res.status(201).json(feedback);
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการสร้าง feedback:', err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดภายใน feedbackController - createFeedback' });
    }
};

// ดึง feedback ของ user คนนั้นๆ สำหรับ mobile app
const getUserFeedback = async (req, res) => {
    try {
        const userId = req.user?.id;
        const rows = await feedbackRepository.findByUserId(userId);
        res.json(rows);
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการดึงข้อมูล feedback ของ user:', err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดภายใน feedbackController - getUserFeedback' });
    }
};

// ส่งรายการ feedback ทั้งหมดสำหรับหน้าจัดการของ admin
const getAllFeedback = async (req, res) => {
    try {
        const rows = await feedbackRepository.findAllWithUsers();
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

        const feedback = await feedbackRepository.updateFeedback(feedbackId, {
            status,
            admin_reply,
        });

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
