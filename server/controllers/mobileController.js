// server/controllers/mobileController.js

const pool = require('../config/db');

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

// GET /api/mobile/destinations/:id — รายละเอียดสถานที่สำหรับ mobile app
const getDestinationDetail = async (req, res) => {
    try {
        const destinationId = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(destinationId)) {
            return res.status(400).json({ message: 'รหัสสถานที่ไม่ถูกต้อง' });
        }

        const { rows } = await pool.query(
            `SELECT id, name, province, description, category, image_url, images,
                    opening_time, closing_time, opening_hours, admission_fee
             FROM destinations
             WHERE id = $1 AND status = 'approved'`,
            [destinationId],
        );
        const destination = rows[0];
        if (!destination) return res.status(404).json({ message: 'ไม่พบสถานที่' });

        const { rows: imageRows } = await pool.query(
            `SELECT image_url FROM destination_images
             WHERE destination_id = $1 ORDER BY id ASC`,
            [destinationId],
        );
        const jsonImages = Array.isArray(destination.images)
            ? destination.images.map((image) =>
                typeof image === 'string' ? image : image?.image_url || image?.url,
            )
            : [];
        const imageUrls = [...new Set([
            destination.image_url,
            ...jsonImages,
            ...imageRows.map((image) => image.image_url),
        ].filter(Boolean))];

        res.json({
            ...destination,
            images: imageUrls.map((image_url) => ({ image_url })),
        });
    } catch (err) {
        console.error('[mobileController] destination detail error:', err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการดึงรายละเอียดสถานที่' });
    }
};

module.exports = {
    getDestinations,
    getDestinationDetail,
};
