// server/controllers/destinationController.js

const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { embedDestination, clearDestinationEmbedding } = require('./helpers/embedHelper');

const PLACE_STATUSES = ['pending', 'approved', 'rejected'];
const normalizePlaceStatus = (status) => {
    const cleanStatus = String(status || 'approved').trim().toLowerCase();
    return PLACE_STATUSES.includes(cleanStatus) ? cleanStatus : 'approved';
};

// ลบไฟล์จริงจาก /uploads (เฉพาะไฟล์ที่อยู่ใน /uploads เท่านั้น)
const deleteUploadedFiles = (imagePaths) => {
    for (const imgPath of imagePaths) {
        if (!imgPath) continue;
        if (!imgPath.startsWith('/uploads/')) continue;
        
        const filename = path.basename(imgPath);
        const fullPath = path.join(__dirname, '..', 'uploads', filename);
        fs.unlink(fullPath, (err) => {
            if (err && err.code !== 'ENOENT') {
                console.error('[deleteUploadedFiles] error:', fullPath, err.message);
            }
        });
    }
};

const normalizeImageUrls = (images) => {
    if (!Array.isArray(images)) return [];
    return [...new Set(images.filter((image) => typeof image === 'string' && image.trim()).map((image) => image.trim()))];
};

const normalizeStoredImages = (images) => {
    if (!Array.isArray(images)) return [];
    return images
        .map((image) => {
            if (typeof image === 'string') return image.trim();
            if (image && typeof image === 'object') {
                return String(image.image_url || image.url || '').trim();
            }
            return '';
        })
        .filter(Boolean);
};

const normalizeAdmissionFee = (fee) => {
    if (!fee || typeof fee !== 'object' || Array.isArray(fee)) return {};
    const result = {};
    for (const key of ['thaiAdult', 'thaiChild', 'foreignerAdult', 'foreignerChild']) {
        const value = fee[key];
        if (value !== null && value !== undefined && String(value).trim() !== '') {
            result[key] = String(value).trim();
        }
    }
    if (fee.detail && String(fee.detail).trim()) result.detail = String(fee.detail).trim();
    return result;
};

const getRemovedImages = (currentImages, nextImages) => {
    const nextSet = new Set(nextImages);
    return currentImages.filter((image) => image && !nextSet.has(image));
};

const validateCoordinates = (latitude, longitude) => {
    if (latitude !== undefined && latitude !== '' && latitude !== null) {
        const lat = parseFloat(latitude);
        if (isNaN(lat) || lat < -90 || lat > 90) {
            return { isValid: false, message: 'ค่าละติจูด (Latitude) ต้องอยู่ระหว่าง -90 ถึง 90' };
        }
    }
    if (longitude !== undefined && longitude !== '' && longitude !== null) {
        const lng = parseFloat(longitude);
        if (isNaN(lng) || lng < -180 || lng > 180) {
            return { isValid: false, message: 'ค่าลองจิจูด (Longitude) ต้องอยู่ระหว่าง -180 ถึง 180' };
        }
    }
    return { isValid: true };
};

/**
 * ดึงรายการสถานที่ทั้งหมด (รองรับตัวกรอง)
 * GET /api/destinations
 */
const getAllDestinations = async (req, res) => {
    try {
        const { province, status, search } = req.query;
        let sql = 'SELECT id, name, province, category, image_url, status, source, created_at FROM destinations';
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
        res.json(rows);
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการดึงรายการสถานที่:', err);
        res.status(500).json({ message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" });
    }
};

/**
 * ดึงข้อมูลสถานที่ตาม ID พร้อมรูปภาพ
 * GET /api/destinations/:id
 */
const getDestinationById = async (req, res) => {
    try {
        const destId = parseInt(req.params.id, 10);
        const { rows: destRows } = await pool.query(
            'SELECT * FROM destinations WHERE id = $1',
            [destId]
        );
        const destination = destRows[0] || null;

        if (!destination) {
            return res.status(404).json({ message: 'ไม่พบสถานที่' });
        }

        const { rows: imageRows } = await pool.query(
            'SELECT id, destination_id, image_url, created_at FROM destination_images WHERE destination_id = $1',
            [destId]
        );
        const jsonImages = normalizeStoredImages(destination.images);
        const tableImages = imageRows.map((image) => image.image_url).filter(Boolean);
        const combinedUrls = [...new Set([
            destination.image_url,
            ...jsonImages,
            ...tableImages,
        ].filter(Boolean))];
        destination.images = combinedUrls.map((imageUrl) => {
            const tableRow = imageRows.find((image) => image.image_url === imageUrl);
            return tableRow || {
                id: null,
                destination_id: destId,
                image_url: imageUrl,
                created_at: null,
            };
        });

        res.json(destination);
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการดึงข้อมูลสถานที่:', err);
        res.status(500).json({ message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" });
    }
};

/**
 * สร้างสถานที่ใหม่
 * POST /api/destinations
 */
const createDestination = async (req, res) => {
    try {
        if (!req.body.name || !req.body.name.trim()) {
            return res.status(400).json({ message: 'กรุณากรอกชื่อสถานที่' });
        }

        const coordValidation = validateCoordinates(req.body.latitude, req.body.longitude);
        if (!coordValidation.isValid) {
            return res.status(400).json({ message: coordValidation.message });
        }

        const data = req.body;
        const images = req.body.images;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const { rows } = await client.query(
                `INSERT INTO destinations (name, province, description, latitude, longitude, opening_time, closing_time, status, source, image_url, admission_fee)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'admin', $9, $10)
                 RETURNING id`,
                [
                    data.name.trim(),
                    data.province || null,
                    data.description || null,
                    data.latitude !== '' && data.latitude != null ? parseFloat(data.latitude) : null,
                    data.longitude !== '' && data.longitude != null ? parseFloat(data.longitude) : null,
                    data.opening_time || '00:00 AM',
                    data.closing_time || '00:00 PM',
                    normalizePlaceStatus(data.status),
                    data.image_url || null,
                    JSON.stringify(normalizeAdmissionFee(data.admission_fee)),
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

            if ((data.status || 'approved') === 'approved') {
                await embedDestination(destId);
            } else {
                await clearDestinationEmbedding(destId);
            }
            res.status(201).json({ id: destId, message: 'เพิ่มสถานที่สำเร็จ' });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการเพิ่มสถานที่:', err);
        res.status(400).json({ message: "ไม่สามารถเพิ่มสถานที่ได้" });
    }
};

/**
 * อัปเดตข้อมูลสถานที่
 * PUT /api/destinations/:id
 */
const updateDestination = async (req, res) => {
    try {
        const destId = parseInt(req.params.id, 10);
        const nextImages = normalizeImageUrls(req.body.images);

        const coordValidation = validateCoordinates(req.body.latitude, req.body.longitude);
        if (!coordValidation.isValid) {
            return res.status(400).json({ message: coordValidation.message });
        }

        const data = req.body;
        const client = await pool.connect();
        let result;
        try {
            await client.query('BEGIN');

            const { rows: existingRows } = await client.query(
                'SELECT id, image_url, admission_fee FROM destinations WHERE id = $1 AND source = $2 LIMIT 1',
                [destId, 'admin']
            );

            if (existingRows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ message: 'ไม่พบสถานที่ หรือไม่ใช่ข้อมูลของ Admin' });
            }

            await client.query(
                `UPDATE destinations
                 SET name = $1, province = $2, description = $3, latitude = $4, longitude = $5,
                      opening_time = $6, closing_time = $7, status = $8, image_url = $9,
                      admission_fee = $10, updated_at = NOW()
                 WHERE id = $11`,
                [
                    data.name,
                    data.province || null,
                    data.description || null,
                    data.latitude !== '' && data.latitude != null ? parseFloat(data.latitude) : null,
                    data.longitude !== '' && data.longitude != null ? parseFloat(data.longitude) : null,
                    data.opening_time,
                    data.closing_time,
                    normalizePlaceStatus(data.status),
                    data.image_url || null,
                    JSON.stringify({
                        ...normalizeAdmissionFee(existingRows[0].admission_fee),
                        ...normalizeAdmissionFee(data.admission_fee),
                    }),
                    destId
                ]
            );

            const { rows: oldImgs } = await client.query(
                'SELECT image_url FROM destination_images WHERE destination_id = $1',
                [destId]
            );
            const currentGalleryImages = oldImgs.map((row) => row.image_url).filter(Boolean);

            await client.query('DELETE FROM destination_images WHERE destination_id = $1', [destId]);

            if (nextImages && nextImages.length > 0) {
                const values = [];
                const placeholders = [];
                nextImages.forEach((url, i) => {
                    const offset = i * 2;
                    placeholders.push(`($${offset + 1}, $${offset + 2})`);
                    values.push(destId, url);
                });
                await client.query(
                    `INSERT INTO destination_images (destination_id, image_url) VALUES ${placeholders.join(', ')}`,
                    values
                );
            }

            await client.query('COMMIT');

            result = {
                previousMainImage: existingRows[0].image_url,
                currentGalleryImages
            };
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

        const removedImagePaths = getRemovedImages(result.currentGalleryImages, nextImages);
        const previousMainImage = result.previousMainImage;

        if (previousMainImage && previousMainImage !== req.body.image_url && !nextImages.includes(previousMainImage)) {
            removedImagePaths.push(previousMainImage);
        }

        deleteUploadedFiles(removedImagePaths);

        if ((req.body.status || 'approved') === 'approved') {
            await embedDestination(destId);
        } else {
            await clearDestinationEmbedding(destId);
        }

        res.json({ message: 'อัปเดตสถานที่สำเร็จ' });
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการอัปเดตสถานที่:', err);
        res.status(400).json({ message: "ไม่สามารถอัปเดตสถานที่ได้" });
    }
};

/**
 * ลบสถานที่
 * DELETE /api/destinations/:id
 */
const deleteDestination = async (req, res) => {
    try {
        const destId = parseInt(req.params.id, 10);
        
        const { rows: existingRows } = await pool.query(
            'SELECT id FROM destinations WHERE id = $1 LIMIT 1',
            [destId]
        );

        if (existingRows.length === 0) {
            return res.status(404).json({ message: 'ไม่พบสถานที่' });
        }

        const { rows: destRows } = await pool.query(
            'SELECT image_url FROM destinations WHERE id = $1',
            [destId]
        );
        const { rows: imgRows } = await pool.query(
            'SELECT image_url FROM destination_images WHERE destination_id = $1',
            [destId]
        );

        const imagePaths = [];
        if (destRows.length > 0 && destRows[0].image_url) imagePaths.push(destRows[0].image_url);
        imgRows.forEach((row) => {
            if (row.image_url) imagePaths.push(row.image_url);
        });

        await pool.query('DELETE FROM destinations WHERE id = $1', [destId]);

        deleteUploadedFiles(imagePaths);
        await clearDestinationEmbedding(destId);
        res.json({ message: 'ลบสถานที่สำเร็จ' });
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการลบสถานที่:', err);
        res.status(500).json({ message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" });
    }
};

module.exports = {
    getAllDestinations,
    getDestinationById,
    createDestination,
    updateDestination,
    deleteDestination
};
