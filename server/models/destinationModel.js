const pool = require('../config/db');

class DestinationModel {
    static async getAll({ province, status, search }) {
        let sql = 'SELECT id, name, province, image_url, status, source, created_at FROM destinations';
        const conditions = [];
        const params = [];

        const allowedStatuses = ['pending', 'approved', 'rejected'];

        if (province && typeof province === 'string' && province.trim()) {
            const cleanProvince = province.trim();
            if (/^[a-zA-Z0-9ก-๙\s\.-]+$/.test(cleanProvince)) {
                params.push(cleanProvince);
                conditions.push(`province = $${params.length}`);
            }
        }
        if (status && typeof status === 'string') {
            const cleanStatus = status.trim().toLowerCase();
            if (allowedStatuses.includes(cleanStatus)) {
                params.push(cleanStatus);
                conditions.push(`status = $${params.length}`);
            }
        }
        if (search) {
            params.push(`%${search}%`);
            conditions.push(`name ILIKE $${params.length}`);
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }

        sql += ' ORDER BY created_at DESC';

        const { rows } = await pool.query(sql, params);
        return rows;
    }

    static async getById(id) {
        const { rows: destRows } = await pool.query(
            'SELECT * FROM destinations WHERE id = $1',
            [id]
        );
        const destination = destRows[0] || null;

        if (destination) {
            const { rows: imageRows } = await pool.query(
                'SELECT id, destination_id, image_url, created_at FROM destination_images WHERE destination_id = $1',
                [id]
            );
            destination.images = imageRows;
        }

        return destination;
    }

    static async create(data, images) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const { rows } = await client.query(
                `INSERT INTO destinations (name, province, description, latitude, longitude, opening_time, closing_time, status, source, image_url)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'admin', $9)
                 RETURNING id`,
                [
                    data.name.trim(),
                    data.province || null,
                    data.description || null,
                    data.latitude !== '' && data.latitude != null ? parseFloat(data.latitude) : null,
                    data.longitude !== '' && data.longitude != null ? parseFloat(data.longitude) : null,
                    data.opening_time || '00:00 AM',
                    data.closing_time || '00:00 PM',
                    data.status || 'published',
                    data.image_url || null
                ]
            );
            
            const destId = rows[0].id;
            
            if (Array.isArray(images) && images.length > 0) {
                const validUrls = images.filter(Boolean);
                if (validUrls.length > 0) {
                    const values = [];
                    const placeholders = [];
                    validUrls.forEach((url, i) => {
                        const offset = i * 2;
                        placeholders.push(`($${offset + 1}, $${offset + 2})`);
                        values.push(destId, url);
                    });
                    await client.query(
                        `INSERT INTO destination_images (destination_id, image_url) VALUES ${placeholders.join(', ')}`,
                        values
                    );
                }
            }

            await client.query('COMMIT');
            return destId;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    static async update(id, data, nextImages) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { rows: existingRows } = await client.query(
                'SELECT id, image_url FROM destinations WHERE id = $1 AND source = $2 LIMIT 1',
                [id, 'admin']
            );

            if (existingRows.length === 0) {
                await client.query('ROLLBACK');
                return null;
            }

            await client.query(
                `UPDATE destinations
                 SET name = $1, province = $2, description = $3, latitude = $4, longitude = $5,
                      opening_time = $6, closing_time = $7, status = $8, image_url = $9, updated_at = NOW()
                 WHERE id = $10`,
                [
                    data.name,
                    data.province || null,
                    data.description || null,
                    data.latitude !== '' && data.latitude != null ? parseFloat(data.latitude) : null,
                    data.longitude !== '' && data.longitude != null ? parseFloat(data.longitude) : null,
                    data.opening_time,
                    data.closing_time,
                    data.status,
                    data.image_url || null,
                    id
                ]
            );

            const { rows: oldImgs } = await client.query(
                'SELECT image_url FROM destination_images WHERE destination_id = $1',
                [id]
            );
            const currentGalleryImages = oldImgs.map((row) => row.image_url).filter(Boolean);

            await client.query('DELETE FROM destination_images WHERE destination_id = $1', [id]);

            if (nextImages && nextImages.length > 0) {
                const values = [];
                const placeholders = [];
                nextImages.forEach((url, i) => {
                    const offset = i * 2;
                    placeholders.push(`($${offset + 1}, $${offset + 2})`);
                    values.push(id, url);
                });
                await client.query(
                    `INSERT INTO destination_images (destination_id, image_url) VALUES ${placeholders.join(', ')}`,
                    values
                );
            }

            await client.query('COMMIT');

            return {
                previousMainImage: existingRows[0].image_url,
                currentGalleryImages
            };
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    static async delete(id) {
        const { rows: existingRows } = await pool.query(
            'SELECT id FROM destinations WHERE id = $1 AND source = $2 LIMIT 1',
            [id, 'admin']
        );

        if (existingRows.length === 0) {
            return null;
        }

        const { rows: destRows } = await pool.query(
            'SELECT image_url FROM destinations WHERE id = $1',
            [id]
        );
        const { rows: imgRows } = await pool.query(
            'SELECT image_url FROM destination_images WHERE destination_id = $1',
            [id]
        );

        const imagePaths = [];
        if (destRows.length > 0 && destRows[0].image_url) imagePaths.push(destRows[0].image_url);
        imgRows.forEach((row) => {
            if (row.image_url) imagePaths.push(row.image_url);
        });

        await pool.query('DELETE FROM destinations WHERE id = $1', [id]);
        return imagePaths;
    }
}

module.exports = DestinationModel;

