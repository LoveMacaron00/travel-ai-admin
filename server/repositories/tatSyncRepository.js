// server/repositories/tatSyncRepository.js
// ชั้นเข้าถึงฐานข้อมูลของ TAT sync — ย้าย SQL ออกจาก sync engine
const pool = require('../config/db');

// เพิ่มหรืออัปเดตคำแปลของสถานที่ คืน true เสมอ
const upsertTranslation = async (destinationId, languageCode, translation, db = pool) => {
    await db.query(
        `INSERT INTO destination_translations (
            destination_id, language_code, name, address, province,
            district, sub_district, postcode, description,
            tags, opening_hours, admission_fee, tat_raw
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (destination_id, language_code) DO UPDATE SET
            name = EXCLUDED.name,
            address = EXCLUDED.address,
            province = EXCLUDED.province,
            district = EXCLUDED.district,
            sub_district = EXCLUDED.sub_district,
            postcode = EXCLUDED.postcode,
            description = EXCLUDED.description,
            tags = EXCLUDED.tags,
            opening_hours = EXCLUDED.opening_hours,
            admission_fee = EXCLUDED.admission_fee,
            tat_raw = EXCLUDED.tat_raw,
            updated_at = NOW()`,
        [
            destinationId,
            languageCode,
            translation.name,
            translation.address,
            translation.province,
            translation.district,
            translation.subDistrict,
            translation.postcode,
            translation.description,
            translation.tags,
            JSON.stringify(translation.openingHours),
            JSON.stringify(translation.admissionFee),
            JSON.stringify(translation.tatRaw),
        ],
    );
    return true;
};

// เพิ่มหรืออัปเดตสถานที่ TAT (ชน tat_place_id) คืน { id }
const upsertPlace = async ({
    name,
    address,
    provinceId,
    province,
    districtId,
    district,
    subDistrictId,
    subDistrict,
    postcode,
    description,
    category,
    tags,
    latitude,
    longitude,
    openingTime,
    closingTime,
    openingHoursJson,
    mainImageUrl,
    imagesJson,
    tatPlaceId,
    tatRawJson,
    admissionFeeJson,
}, db = pool) => {
    const { rows } = await db.query(
        `INSERT INTO destinations (
            name, address, province_id, province, district_id, district,
            sub_district_id, sub_district, postcode,
            description, category, tags, latitude, longitude,
            opening_time, closing_time, opening_hours,
            image_url, images, source, status,
            tat_place_id, tat_raw, admission_fee
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'tat','approved',$20,$21,$22)
        ON CONFLICT (tat_place_id) DO UPDATE SET
            name = EXCLUDED.name,
            address = EXCLUDED.address,
            province_id = EXCLUDED.province_id,
            province = EXCLUDED.province,
            district_id = EXCLUDED.district_id,
            district = EXCLUDED.district,
            sub_district_id = EXCLUDED.sub_district_id,
            sub_district = EXCLUDED.sub_district,
            postcode = EXCLUDED.postcode,
            description = EXCLUDED.description,
            category = EXCLUDED.category,
            tags = EXCLUDED.tags,
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude,
            opening_time = EXCLUDED.opening_time,
            closing_time = EXCLUDED.closing_time,
            opening_hours = EXCLUDED.opening_hours,
            image_url = EXCLUDED.image_url,
            images = EXCLUDED.images,
            tat_raw = EXCLUDED.tat_raw,
            admission_fee = EXCLUDED.admission_fee,
            updated_at = NOW()
        RETURNING id`,
        [
            name, address, provinceId, province, districtId, district,
            subDistrictId, subDistrict, postcode,
            description, category, tags, latitude, longitude,
            openingTime, closingTime, openingHoursJson,
            mainImageUrl, imagesJson,
            tatPlaceId, tatRawJson, admissionFeeJson,
        ],
    );
    return rows[0];
};

// แทนที่รูปรายการของสถานที่ด้วยชุดใหม่
const replacePlaceImages = async (destinationId, imageUrls, db = pool) => {
    await db.query('DELETE FROM destination_images WHERE destination_id = $1', [destinationId]);
    if (imageUrls.length > 0) {
        const values = [];
        const placeholders = imageUrls.map((imageUrl, index) => {
            values.push(destinationId, imageUrl);
            return `($${index * 2 + 1}, $${index * 2 + 2})`;
        });
        await db.query(
            `INSERT INTO destination_images (destination_id, image_url)
             VALUES ${placeholders.join(', ')}`,
            values,
        );
    }
};

// สถานที่ TAT ที่ยังไม่มีคำแปลภาษาอังกฤษ เรียงตาม id
const findTatPlacesMissingEnglish = async (db = pool) => {
    const { rows } = await db.query(
        `SELECT d.id, d.tat_place_id
         FROM destinations d
         LEFT JOIN destination_translations english
           ON english.destination_id = d.id
          AND english.language_code = 'en'
         WHERE d.source = 'tat'
           AND d.tat_place_id IS NOT NULL
           AND english.destination_id IS NULL
         ORDER BY d.id ASC`,
    );
    return rows;
};

module.exports = {
    upsertTranslation,
    upsertPlace,
    replacePlaceImages,
    findTatPlacesMissingEnglish,
};
