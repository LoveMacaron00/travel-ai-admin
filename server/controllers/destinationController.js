// Controller: Destination (สถานที่ท่องเที่ยว)
// จัดการ logic CRUD สำหรับสถานที่ท่องเที่ยว

const fs = require('fs');
const path = require('path');
const { query } = require('../db');

const insertImages = async (destId, images) => {
    const imageList = Array.isArray(images) ? images : [];
    const validUrls = imageList.filter(Boolean);

    if (validUrls.length === 0) return;

    const values = [];
    const placeholders = [];

    validUrls.forEach((url, i) => {
        const offset = i * 2;
        placeholders.push(`($${offset + 1}, $${offset + 2})`);
        values.push(destId, url);
    });

    await query(
        `INSERT INTO destination_images (destination_id, image_url) VALUES ${placeholders.join(', ')}`,
        values
    );
};

// ลบไฟล์จริงจาก /uploads (เฉพาะไฟล์ที่อยู่ใน /uploads เท่านั้น)
const deleteUploadedFiles = (imagePaths) => {
    console.log('[deleteUploadedFiles] paths:', imagePaths);
    for (const imgPath of imagePaths) {
        if (!imgPath) continue;
        // imgPath เช่น /uploads/filename.jpg
        if (!imgPath.startsWith('/uploads/')) {
            console.log('[deleteUploadedFiles] skip (not /uploads/):', imgPath);
            continue;
        }
        const filename = path.basename(imgPath);
        const fullPath = path.join(__dirname, '..', 'uploads', filename);
        console.log('[deleteUploadedFiles] deleting:', fullPath);
        fs.unlink(fullPath, (err) => {
            if (err) {
                console.error('[deleteUploadedFiles] error:', fullPath, err.message);
            } else {
                console.log('[deleteUploadedFiles] deleted:', fullPath);
            }
        });
    }
};

/**
 * ดึงรายการสถานที่ทั้งหมด (รองรับตัวกรอง)
 * GET /api/destinations
 */
const getAllDestinations = async (req, res) => {
    try {
        const { province, status, search } = req.query;
        let sql = 'SELECT id, name, province, image_url, status, source, created_at FROM destinations';
        const conditions = [];
        const params = [];

        if (province) {
            params.push(province);
            conditions.push(`province = $${params.length}`);
        }
        if (status) {
            params.push(status);
            conditions.push(`status = $${params.length}`);
        }
        if (search) {
            params.push(`%${search}%`);
            conditions.push(`name ILIKE $${params.length}`);
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }

        sql += ' ORDER BY created_at DESC';

        const { rows } = await query(sql, params);
        const destinations = rows;
        res.json(destinations);
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการดึงรายการสถานที่:', err);
        res.status(500).json({ message: "เกิดข้อผิดพลาดภายใน destinationController - getAllDestinations" });
    }
};

/**
 * ดึงข้อมูลสถานที่ตาม ID พร้อมรูปภาพ
 * GET /api/destinations/:id
 */
const getDestinationById = async (req, res) => {
    try {
        const destId = parseInt(req.params.id, 10);
        const { rows: destRows } = await query(
            'SELECT * FROM destinations WHERE id = $1',
            [destId]
        );

        const destination = destRows[0] || null;

        if (!destination) {
            return res.status(404).json({ message: 'ไม่พบสถานที่' });
        }

        const { rows: imageRows } = await query(
            'SELECT id, destination_id, image_url, created_at FROM destination_images WHERE destination_id = $1',
            [destId]
        );

        destination.images = imageRows;

        res.json(destination);
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการดึงข้อมูลสถานที่:', err);
        res.status(500).json({ message: "เกิดข้อผิดพลาดภายใน destinationController - getDestinationById" });
    }
};

/**
 * สร้างสถานที่ใหม่
 * POST /api/destinations
 */
const createDestination = async (req, res) => {
    try {
        const { name } = req.body;

        // ตรวจสอบว่ากรอกชื่อสถานที่หรือไม่
        if (!name || !name.trim()) {
            return res.status(400).json({ message: 'กรุณากรอกชื่อสถานที่' });
        }

        const {
            province, description,
            latitude, longitude,
            opening_time, closing_time,
            status, image_url, images
        } = req.body;

        const lat = latitude !== '' && latitude != null ? parseFloat(latitude) : null;
        const lng = longitude !== '' && longitude != null ? parseFloat(longitude) : null;

        const { rows } = await query(
            `INSERT INTO destinations (name, province, description, latitude, longitude, opening_time, closing_time, status, source, image_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'admin', $9)
             RETURNING id`,
            [
                name.trim(),
                province || null,
                description || null,
                lat,
                lng,
                opening_time || '00:00 AM',
                closing_time || '00:00 PM',
                status || 'published',
                image_url || null
            ]
        );

        const destId = rows[0].id;
        await insertImages(destId, images);
        res.status(201).json({ id: destId, message: 'เพิ่มสถานที่สำเร็จ' });
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการเพิ่มสถานที่:', err);
        res.status(400).json({ message: "เกิดข้อผิดพลาดภายใน destinationController - createDestination" });
    }
};

/**
 * อัปเดตข้อมูลสถานที่
 * PUT /api/destinations/:id
 */
const updateDestination = async (req, res) => {
    try {
        const {
            name, province, description,
            latitude, longitude,
            opening_time, closing_time,
            status, image_url, images
        } = req.body;

        const destId = parseInt(req.params.id, 10);
        const lat = latitude !== '' && latitude != null ? parseFloat(latitude) : null;
        const lng = longitude !== '' && longitude != null ? parseFloat(longitude) : null;

        const { rows: existingRows } = await query(
            'SELECT id FROM destinations WHERE id = $1 AND source = $2 LIMIT 1',
            [destId, 'admin']
        );

        if (existingRows.length === 0) {
            return res.status(404).json({ message: 'ไม่พบสถานที่ หรือไม่ใช่ข้อมูลของ Admin' });
        }

        await query(
            `UPDATE destinations
             SET name = $1, province = $2, description = $3, latitude = $4, longitude = $5,
                 opening_time = $6, closing_time = $7, status = $8, image_url = $9, updated_at = NOW()
             WHERE id = $10`,
            [
                name,
                province || null,
                description || null,
                lat,
                lng,
                opening_time,
                closing_time,
                status,
                image_url || null,
                destId
            ]
        );

        const { rows: oldImgs } = await query(
            'SELECT image_url FROM destination_images WHERE destination_id = $1',
            [destId]
        );
        const removedImagePaths = oldImgs.map((row) => row.image_url).filter(Boolean);

        await query('DELETE FROM destination_images WHERE destination_id = $1', [destId]);
        await insertImages(destId, images);

        // ลบไฟล์รูปเก่าที่ถูกแทนที่ออกจาก /uploads
        deleteUploadedFiles(removedImagePaths);

        res.json({ message: 'อัปเดตสถานที่สำเร็จ' });
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการอัปเดตสถานที่:', err);
        res.status(400).json({ message: "เกิดข้อผิดพลาดภายใน destinationController - updateDestination" });
    }
};

/**
 * ลบสถานที่
 * DELETE /api/destinations/:id
 */
const deleteDestination = async (req, res) => {
    try {
        const destId = parseInt(req.params.id, 10);
        const { rows: existingRows } = await query(
            'SELECT id FROM destinations WHERE id = $1 AND source = $2 LIMIT 1',
            [destId, 'admin']
        );

        if (existingRows.length === 0) {
            return res.status(404).json({ message: 'ไม่พบสถานที่ หรือไม่ใช่ข้อมูลของ Admin' });
        }

        const { rows: destRows } = await query(
            'SELECT image_url FROM destinations WHERE id = $1',
            [destId]
        );
        const { rows: imgRows } = await query(
            'SELECT image_url FROM destination_images WHERE destination_id = $1',
            [destId]
        );

        const imagePaths = [];
        if (destRows.length > 0 && destRows[0].image_url) imagePaths.push(destRows[0].image_url);
        imgRows.forEach((row) => {
            if (row.image_url) imagePaths.push(row.image_url);
        });

        await query('DELETE FROM destinations WHERE id = $1', [destId]);

        // ลบไฟล์รูปทั้งหมดของสถานที่นี้จาก /uploads
        deleteUploadedFiles(imagePaths);

        res.json({ message: 'ลบสถานที่สำเร็จ' });
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการลบสถานที่:', err);
        res.status(500).json({ message: "เกิดข้อผิดพลาดภายใน destinationController - deleteDestination" });
    }
};

module.exports = {
    getAllDestinations,
    getDestinationById,
    createDestination,
    updateDestination,
    deleteDestination
};
