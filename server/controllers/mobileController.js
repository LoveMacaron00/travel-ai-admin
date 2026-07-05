const { mobileRagChat } = require('./helpers/aiHelper');
const pool = require('../config/db');

/**
 * ดึงสถานที่จากฐานข้อมูล destinations สำหรับ mobile app
 * GET /api/mobile/destinations
 */
const getDestinations = async (req, res) => {
    try {
        const limit = req.query.limit ? parseInt(req.query.limit, 10) : null;

        let sql = `
            SELECT 
                id,
                name,
                province,
                description,
                latitude,
                longitude,
                image_url AS image,
                category
            FROM destinations
            WHERE status = 'approved'
              AND latitude IS NOT NULL
              AND longitude IS NOT NULL
            ORDER BY created_at DESC
        `;

        if (limit && limit > 0) {
            sql += ` LIMIT ${limit}`;
        }

        const { rows } = await pool.query(sql);

        const data = rows.map(row => ({
            id: row.id,
            name: row.name,
            city: row.province || 'Thailand',
            location: row.province || 'Thailand',
            description: row.description || '',
            latitude: row.latitude,
            longitude: row.longitude,
            image: row.image || '',
            category: row.category || 'Temple',
        }));

        res.json({ data });
    } catch (err) {
        console.error('[mobileController] -destinations error:', err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการดึงข้อมูลสถานที่' });
    }
};

const chatWithAssistant = async (req, res) => {
    try {
        const { message, province } = req.body;
        if (!message?.trim()) {
            return res.status(400).json({ message: 'กรุณาระบุข้อความ' });
        }

        const data = await mobileRagChat(message.trim(), {
            province: province || null,
            limit: 5,
        });

        res.json(data);
    } catch (err) {
        console.error('[mobileController] chat error:', err);
        res.status(500).json({
            message: 'เกิดข้อผิดพลาดในการตอบคำถามท่องเที่ยว'
        });
    }
};

module.exports = {
    getDestinations,
    chatWithAssistant
};
