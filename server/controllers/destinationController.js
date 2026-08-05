// server/controllers/destinationController.js

const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { embedDestination, clearDestinationEmbedding } = require('./helpers/embedHelper');

const PLACE_STATUSES = ['pending', 'approved', 'rejected'];
// แปลงสถานะสถานที่ให้เหลือค่าที่ระบบรองรับ
const normalizePlaceStatus = (status) => {
    const cleanStatus = String(status || 'approved').trim().toLowerCase();
    return PLACE_STATUSES.includes(cleanStatus) ? cleanStatus : 'approved';
};

// ลบไฟล์จริงจาก /uploads (เฉพาะไฟล์ที่อยู่ใน /uploads เท่านั้น)
// ลบไฟล์รูปที่ไม่ถูกอ้างอิงแล้วจากโฟลเดอร์ upload
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

// ฟังก์ชันสำหรับ normalize ข้อมูลรูปภาพจาก request body (array ของ string)
// แปลง input URL รูปให้เป็นรายการข้อความที่ไม่ว่างและไม่ซ้ำ
const normalizeImageUrls = (images) => {
    if (!Array.isArray(images)) return [];
    return [...new Set(images.filter((image) => typeof image === 'string' && image.trim()).map((image) => image.trim()))];
};

// ฟังก์ชันสำหรับ normalize ข้อมูลรูปภาพจากฐานข้อมูล (JSON หรือ array)
// แปลงค่ารูปที่เก็บในฐานข้อมูลเป็น array ที่ใช้งานได้เสมอ
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

// ฟังก์ชันสำหรับทำให้ค่า admission_fee เป็น object ที่มี key-value ที่ถูกต้อง
// ทำให้ข้อมูลค่าเข้าชมอยู่ในรูปแบบ object ที่ปลอดภัยต่อการบันทึก
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

// ฟังก์ชันสำหรับทำให้ค่า admission_fee เป็น JSON string สำหรับเก็บในฐานข้อมูล
// คืนข้อความที่ trim แล้ว หรือ null เมื่อไม่มีค่า
const nullableText = (value) => {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text || null;
};

// ฟังก์ชันสำหรับทำให้ค่า location_id เป็น number หรือ null
// แปลงรหัสพื้นที่เป็นจำนวนเต็มไม่ติดลบ หรือ null
const nullableLocationId = (value) => {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

// ฟังก์ชันสำหรับ normalize ข้อมูล location จาก request body
// จัดรูปแบบ field ที่อยู่จาก request ก่อนส่งเข้า query
const normalizeLocationInput = (data = {}) => {
    const location = data.location && typeof data.location === 'object' ? data.location : {};
    const province = location.province && typeof location.province === 'object' ? location.province : {};
    const district = location.district && typeof location.district === 'object' ? location.district : {};
    const subDistrict = location.subDistrict && typeof location.subDistrict === 'object'
        ? location.subDistrict
        : {};

    return {
        address: location.address ?? data.address,
        provinceId: province.provinceId ?? data.province_id,
        province: province.name ?? data.province,
        districtId: district.districtId ?? data.district_id,
        district: district.name ?? data.district,
        subDistrictId: subDistrict.subDistrictId ?? data.sub_district_id,
        subDistrict: subDistrict.name ?? data.sub_district,
        postcode: location.postcode ?? data.postcode,
    };
};

// ฟังก์ชันสำหรับหาภาพที่ถูกลบออกจากรายการภาพปัจจุบัน
// หารูปเก่าที่ถูกนำออกจากรายการใหม่
const getRemovedImages = (currentImages, nextImages) => {
    const nextSet = new Set(nextImages);
    return currentImages.filter((image) => image && !nextSet.has(image));
};

// ฟังก์ชันสำหรับตรวจสอบค่าละติจูดและลองจิจูด
// ตรวจละติจูดและลองจิจูดให้อยู่ในขอบเขตพิกัดโลก
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
// ส่งรายการสถานที่ทั้งหมดสำหรับหน้า admin พร้อมตัวกรองและ pagination
const getAllDestinations = async (req, res) => {
    try {
        const { province, status, search, source } = req.query;
        const allowedStatuses = ['pending', 'approved', 'rejected'];
        const allowedSources = ['admin', 'tat'];
        const paginationRequested = req.query.page !== undefined || req.query.limit !== undefined;
        const parsedPage = Number.parseInt(req.query.page, 10);
        const parsedLimit = Number.parseInt(req.query.limit, 10);
        const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
        const limit = Number.isSafeInteger(parsedLimit) && parsedLimit > 0
            ? Math.min(parsedLimit, 100)
            : 10;

        const baseConditions = [];
        const baseParams = [];

        if (source && allowedSources.includes(String(source).trim().toLowerCase())) {
            baseParams.push(String(source).trim().toLowerCase());
            baseConditions.push(`source = $${baseParams.length}`);
        }

        if (province && typeof province === 'string' && province.trim()) {
            const cleanProvince = province.trim();
            if (/^[a-zA-Z0-9ก-๙\s.-]+$/.test(cleanProvince)) {
                baseParams.push(cleanProvince);
                baseConditions.push(`province = $${baseParams.length}`);
            }
        }

        if (search && String(search).trim()) {
            baseParams.push(`%${String(search).trim()}%`);
            const searchParam = `$${baseParams.length}`;
            baseConditions.push(`(
                name ILIKE ${searchParam}
                OR COALESCE(province, '') ILIKE ${searchParam}
                OR COALESCE(address, '') ILIKE ${searchParam}
                OR COALESCE(district, '') ILIKE ${searchParam}
                OR COALESCE(sub_district, '') ILIKE ${searchParam}
                OR COALESCE(category, '') ILIKE ${searchParam}
            )`);
        }

        const conditions = [...baseConditions];
        const params = [...baseParams];
        if (status && typeof status === 'string') {
            const cleanStatus = status.trim().toLowerCase();
            if (allowedStatuses.includes(cleanStatus)) {
                params.push(cleanStatus);
                conditions.push(`status = $${params.length}`);
            }
        }

        const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
        const baseWhereClause = baseConditions.length > 0
            ? ` WHERE ${baseConditions.join(' AND ')}`
            : '';
        let sql = `
            SELECT id, name, province, category, image_url, status, source, created_at
            FROM destinations${whereClause}
            ORDER BY created_at DESC
        `;

        if (!paginationRequested) {
            const { rows } = await pool.query(sql, params);
            return res.json(rows);
        }

        const paginatedParams = [...params, limit, (page - 1) * limit];
        sql += ` LIMIT $${paginatedParams.length - 1} OFFSET $${paginatedParams.length}`;

        const [itemsResult, totalResult, statusResult] = await Promise.all([
            pool.query(sql, paginatedParams),
            pool.query(`SELECT COUNT(*)::int AS total FROM destinations${whereClause}`, params),
            pool.query(
                `SELECT
                    COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
                    COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
                    COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected
                 FROM destinations${baseWhereClause}`,
                baseParams
            )
        ]);

        const total = totalResult.rows[0]?.total || 0;
        res.json({
            data: itemsResult.rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit))
            },
            statusCounts: statusResult.rows[0] || { approved: 0, pending: 0, rejected: 0 }
        });
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการดึงรายการสถานที่:', err);
        res.status(500).json({ message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" });
    }
};

/**
 * ดึงข้อมูลสถานที่ตาม ID พร้อมรูปภาพ
 * GET /api/destinations/:id
 */
// ส่งรายละเอียดสถานที่หนึ่งแห่งสำหรับหน้าแก้ไขของ admin
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
// ตรวจข้อมูลและสร้างสถานที่ใหม่จากฟอร์ม admin
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
        const location = normalizeLocationInput(data);
        const images = req.body.images;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { rows } = await client.query(
                `INSERT INTO destinations (
                    name, address, province_id, province, district_id, district,
                    sub_district_id, sub_district, postcode,
                    description, latitude, longitude, opening_time, closing_time,
                    status, source, image_url, admission_fee
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'admin',$16,$17)
                 RETURNING id`,
                [
                    data.name.trim(),
                    nullableText(location.address),
                    nullableLocationId(location.provinceId),
                    nullableText(location.province),
                    nullableLocationId(location.districtId),
                    nullableText(location.district),
                    nullableLocationId(location.subDistrictId),
                    nullableText(location.subDistrict),
                    nullableText(location.postcode),
                    nullableText(data.description),
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
// อัปเดตสถานที่และลบไฟล์รูปที่ไม่ได้ใช้งานแล้ว
const updateDestination = async (req, res) => {
    try {
        const destId = parseInt(req.params.id, 10);
        const nextImages = normalizeImageUrls(req.body.images);

        const coordValidation = validateCoordinates(req.body.latitude, req.body.longitude);
        if (!coordValidation.isValid) {
            return res.status(400).json({ message: coordValidation.message });
        }

        const data = req.body;
        const location = normalizeLocationInput(data);
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
                 SET name = $1, address = $2, province_id = $3, province = $4,
                     district_id = $5, district = $6,
                     sub_district_id = $7, sub_district = $8,
                     postcode = $9, description = $10,
                     latitude = $11, longitude = $12, opening_time = $13,
                     closing_time = $14, status = $15, image_url = $16,
                     admission_fee = $17, updated_at = NOW()
                 WHERE id = $18`,
                [
                    data.name,
                    nullableText(location.address),
                    nullableLocationId(location.provinceId),
                    nullableText(location.province),
                    nullableLocationId(location.districtId),
                    nullableText(location.district),
                    nullableLocationId(location.subDistrictId),
                    nullableText(location.subDistrict),
                    nullableText(location.postcode),
                    nullableText(data.description),
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
// ลบสถานที่และไฟล์รูปที่เกี่ยวข้องเมื่อไม่มีรายการอ้างอิง
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
