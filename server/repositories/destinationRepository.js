// server/repositories/destinationRepository.js
// ชั้นเข้าถึงฐานข้อมูลของ destinations — ย้าย SQL ออกจาก mobileController/destinationController
// รับ db เสริมได้ (pool หรือ transaction client) เพื่อให้ reuse และทดสอบได้
const pool = require('../config/db');
const { normalizeAdmissionFee } = require('../validators/destinationValidator');

// รายการสถานที่ approved พร้อมคำแปลและยอดดู (limit สูงสุดตามที่ส่งมา)
const findApprovedDestinations = async (language, limit, db = pool) => {
    const params = [language];

    let sql = `
        SELECT
            d.id,
            COALESCE(
                CASE WHEN $1 = 'th' THEN d.name ELSE preferred.name END,
                d.name
            ) AS name,
            COALESCE(
                CASE WHEN $1 = 'th' THEN d.province ELSE preferred.province END,
                d.province
            ) AS province,
            d.province AS province_value,
            COALESCE(
                CASE WHEN $1 = 'th' THEN d.district ELSE preferred.district END,
                d.district
            ) AS district,
            COALESCE(
                CASE WHEN $1 = 'th' THEN d.sub_district ELSE preferred.sub_district END,
                d.sub_district
            ) AS sub_district,
            COALESCE(
                CASE WHEN $1 = 'th' THEN d.description ELSE preferred.description END,
                d.description
            ) AS description,
            d.latitude,
            d.longitude,
            d.image_url AS image,
            d.category,
            (
                SELECT COUNT(*)::int
                FROM destination_view_events view_events
                WHERE view_events.destination_id = d.id
            ) AS viewer
        FROM destinations d
        LEFT JOIN destination_translations preferred
            ON preferred.destination_id = d.id
           AND preferred.language_code = $1
        WHERE d.status = 'approved'
          AND d.latitude IS NOT NULL
          AND d.longitude IS NOT NULL
        ORDER BY d.created_at DESC
    `;

    if (limit) {
        params.push(limit);
        sql += ` LIMIT $${params.length}`;
    }

    const { rows } = await db.query(sql, params);
    return rows;
};

// จังหวัดที่มีสถานที่ approved พร้อมคำแปลและจำนวนสถานที่
const findApprovedProvinces = async (language, db = pool) => {
    const { rows } = await db.query(
        `SELECT
            d.province AS value,
            COALESCE(
                MAX(CASE WHEN $1 = 'en' THEN preferred.province END),
                d.province
            ) AS label,
            COUNT(DISTINCT d.id)::int AS destination_count
         FROM destinations d
         LEFT JOIN destination_translations preferred
            ON preferred.destination_id = d.id
           AND preferred.language_code = $1
         WHERE d.status = 'approved'
           AND d.latitude IS NOT NULL
           AND d.longitude IS NOT NULL
           AND NULLIF(BTRIM(d.province), '') IS NOT NULL
         GROUP BY d.province
         ORDER BY label ASC`,
        [language],
    );
    return rows;
};

// รายละเอียดสถานที่ approved หนึ่งแห่งพร้อมคำแปล คืนแถวหรือ null
const findApprovedDestinationDetail = async (destinationId, language, db = pool) => {
    const { rows } = await db.query(
        `SELECT
            d.id,
            COALESCE(
                CASE WHEN $2 = 'th' THEN d.name ELSE preferred.name END,
                d.name
            ) AS name,
            d.province_id,
            COALESCE(
                CASE WHEN $2 = 'th' THEN d.province ELSE preferred.province END,
                d.province
            ) AS province,
            d.district_id,
            COALESCE(
                CASE WHEN $2 = 'th' THEN d.district ELSE preferred.district END,
                d.district
            ) AS district,
            d.sub_district_id,
            COALESCE(
                CASE WHEN $2 = 'th' THEN d.sub_district ELSE preferred.sub_district END,
                d.sub_district
            ) AS sub_district,
            COALESCE(
                CASE WHEN $2 = 'th' THEN d.postcode ELSE preferred.postcode END,
                d.postcode
            ) AS postcode,
            COALESCE(
                CASE WHEN $2 = 'th' THEN d.description ELSE preferred.description END,
                d.description
            ) AS description,
            COALESCE(
                CASE WHEN $2 = 'th' THEN d.address ELSE preferred.address END,
                d.address
            ) AS address,
            COALESCE(
                CASE WHEN $2 = 'th' THEN d.tags ELSE preferred.tags END,
                d.tags
            ) AS tags,
            d.category,
            d.image_url,
            d.images,
            d.opening_time,
            d.closing_time,
            COALESCE(
                CASE WHEN $2 = 'th' THEN d.opening_hours ELSE preferred.opening_hours END,
                d.opening_hours
            ) AS opening_hours,
            COALESCE(
                CASE WHEN $2 = 'th' THEN d.admission_fee ELSE preferred.admission_fee END,
                d.admission_fee
            ) AS admission_fee,
            COALESCE(
                CASE WHEN $2 = 'th' THEN d.tat_raw ELSE preferred.tat_raw END,
                d.tat_raw
            ) AS tat_raw
         FROM destinations d
         LEFT JOIN destination_translations preferred
            ON preferred.destination_id = d.id
           AND preferred.language_code = $2
         WHERE d.id = $1 AND d.status = 'approved'`,
        [destinationId, language],
    );
    return rows[0] || null;
};

// URL รูปเพิ่มเติมของสถานที่ เรียงตาม id
const findDestinationImageUrls = async (destinationId, db = pool) => {
    const { rows } = await db.query(
        `SELECT image_url FROM destination_images
         WHERE destination_id = $1 ORDER BY id ASC`,
        [destinationId],
    );
    return rows.map((image) => image.image_url);
};

// ---------- Admin CRUD ----------

// ค้นหาสถานที่สำหรับหน้า admin พร้อมตัวกรอง
// คืน array ตรงๆ เมื่อไม่ขอ pagination, คืน { data, pagination, statusCounts } เมื่อขอ
const searchAdminDestinations = async (
    { source, province, search, status, page, limit, paginationRequested },
    db = pool,
) => {
    const allowedStatuses = ['pending', 'approved', 'rejected'];
    const allowedSources = ['admin', 'tat'];

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
        const { rows } = await db.query(sql, params);
        return rows;
    }

    const paginatedParams = [...params, limit, (page - 1) * limit];
    sql += ` LIMIT $${paginatedParams.length - 1} OFFSET $${paginatedParams.length}`;

    const [itemsResult, totalResult, statusResult] = await Promise.all([
        db.query(sql, paginatedParams),
        db.query(`SELECT COUNT(*)::int AS total FROM destinations${whereClause}`, params),
        db.query(
            `SELECT
                COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
                COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
                COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected
             FROM destinations${baseWhereClause}`,
            baseParams,
        ),
    ]);

    const total = totalResult.rows[0]?.total || 0;
    return {
        data: itemsResult.rows,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / limit)),
        },
        statusCounts: statusResult.rows[0] || { approved: 0, pending: 0, rejected: 0 },
    };
};

// สถานที่หนึ่งแห่งสำหรับหน้าแก้ไขของ admin (SELECT * ทั้งแถว) คืนแถวหรือ null
const findAdminDestinationById = async (destId, db = pool) => {
    const { rows } = await db.query(
        'SELECT * FROM destinations WHERE id = $1',
        [destId],
    );
    return rows[0] || null;
};

// แถวรูปของสถานที่สำหรับหน้าแก้ไขของ admin
const findAdminDestinationImageRows = async (destId, db = pool) => {
    const { rows } = await db.query(
        'SELECT id, destination_id, image_url, created_at FROM destination_images WHERE destination_id = $1',
        [destId],
    );
    return rows;
};

// สร้างสถานที่พร้อมรูปใน transaction เดียว คืน id
// payload ผ่าน normalize จาก validator แล้ว:
// { name, address, provinceId, province, districtId, district, subDistrictId, subDistrict,
//   postcode, description, category, latitude, longitude, openingTime, closingTime,
//   status, imageUrl, admissionFeeJson, galleryUrls }
const createDestinationWithImages = async (payload) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            `INSERT INTO destinations (
                name, address, province_id, province, district_id, district,
                sub_district_id, sub_district, postcode,
                description, category, latitude, longitude, opening_time, closing_time,
                status, source, image_url, admission_fee
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'admin',$17,$18)
             RETURNING id`,
            [
                payload.name,
                payload.address,
                payload.provinceId,
                payload.province,
                payload.districtId,
                payload.district,
                payload.subDistrictId,
                payload.subDistrict,
                payload.postcode,
                payload.description,
                payload.category,
                payload.latitude,
                payload.longitude,
                payload.openingTime,
                payload.closingTime,
                payload.status,
                payload.imageUrl,
                payload.admissionFeeJson,
            ],
        );
        const destId = rows[0].id;

        const rawGallery = Array.isArray(payload.galleryUrls) ? payload.galleryUrls : [];
        const validUrls = rawGallery.filter(Boolean);
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
                values,
            );
        }

        await client.query('COMMIT');
        return destId;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

// อัปเดตสถานที่พร้อมรูปใน transaction เดียว
// payload.admissionFee = object ค่าเข้าชมใหม่ที่ผ่าน normalize แล้ว (รวมกับของเดิมในนี้)
// คืน { previousMainImage, currentGalleryImages } หรือ null ถ้าไม่ใช่ข้อมูลของ admin
const updateDestinationWithImages = async (destId, payload) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { rows: existingRows } = await client.query(
            'SELECT id, image_url, admission_fee FROM destinations WHERE id = $1 AND source = $2 LIMIT 1',
            [destId, 'admin'],
        );

        if (existingRows.length === 0) {
            await client.query('ROLLBACK');
            return null;
        }

        const admissionFeeJson = JSON.stringify({
            ...normalizeAdmissionFee(existingRows[0].admission_fee),
            ...payload.admissionFee,
        });

        await client.query(
            `UPDATE destinations
             SET name = $1, address = $2, province_id = $3, province = $4,
                 district_id = $5, district = $6,
                 sub_district_id = $7, sub_district = $8,
                 postcode = $9, description = $10, category = $11,
                 latitude = $12, longitude = $13, opening_time = $14,
                 closing_time = $15, status = $16, image_url = $17,
                 admission_fee = $18, updated_at = NOW()
             WHERE id = $19`,
            [
                payload.name,
                payload.address,
                payload.provinceId,
                payload.province,
                payload.districtId,
                payload.district,
                payload.subDistrictId,
                payload.subDistrict,
                payload.postcode,
                payload.description,
                payload.category,
                payload.latitude,
                payload.longitude,
                payload.openingTime,
                payload.closingTime,
                payload.status,
                payload.imageUrl,
                admissionFeeJson,
                destId,
            ],
        );

        const { rows: oldImgs } = await client.query(
            'SELECT image_url FROM destination_images WHERE destination_id = $1',
            [destId],
        );
        const currentGalleryImages = oldImgs.map((row) => row.image_url).filter(Boolean);

        await client.query('DELETE FROM destination_images WHERE destination_id = $1', [destId]);

        const nextImages = payload.galleryUrls || [];
        if (nextImages.length > 0) {
            const values = [];
            const placeholders = [];
            nextImages.forEach((url, i) => {
                const offset = i * 2;
                placeholders.push(`($${offset + 1}, $${offset + 2})`);
                values.push(destId, url);
            });
            await client.query(
                `INSERT INTO destination_images (destination_id, image_url) VALUES ${placeholders.join(', ')}`,
                values,
            );
        }

        await client.query('COMMIT');

        return {
            previousMainImage: existingRows[0].image_url,
            currentGalleryImages,
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

// ลบสถานที่ คืนรายการ path รูปที่เกี่ยวข้อง หรือ null ถ้าไม่พบสถานที่
const removeDestination = async (destId, db = pool) => {
    const { rows: existingRows } = await db.query(
        'SELECT id FROM destinations WHERE id = $1 LIMIT 1',
        [destId],
    );

    if (existingRows.length === 0) return null;

    const { rows: destRows } = await db.query(
        'SELECT image_url FROM destinations WHERE id = $1',
        [destId],
    );
    const { rows: imgRows } = await db.query(
        'SELECT image_url FROM destination_images WHERE destination_id = $1',
        [destId],
    );

    const imagePaths = [];
    if (destRows.length > 0 && destRows[0].image_url) imagePaths.push(destRows[0].image_url);
    imgRows.forEach((row) => {
        if (row.image_url) imagePaths.push(row.image_url);
    });

    await db.query('DELETE FROM destinations WHERE id = $1', [destId]);

    return imagePaths;
};

module.exports = {
    findApprovedDestinations,
    findApprovedProvinces,
    findApprovedDestinationDetail,
    findDestinationImageUrls,
    searchAdminDestinations,
    findAdminDestinationById,
    findAdminDestinationImageRows,
    createDestinationWithImages,
    updateDestinationWithImages,
    removeDestination,
};
