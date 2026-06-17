const FeedbackModel = require('../models/feedbackModel');

const getAllFeedback = async (req, res) => {
    try {
        const feedbacks = await FeedbackModel.getAll();
        res.json(feedbacks);
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการดึงข้อมูล feedback:', err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดภายใน feedbackController - getAllFeedback' });
    }
};

const updateFeedback = async (req, res) => {
    try {
        const { status, admin_reply } = req.body;
        const feedbackId = parseInt(req.params.id, 10);
        
        const feedback = await FeedbackModel.update(feedbackId, status, admin_reply);
        
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