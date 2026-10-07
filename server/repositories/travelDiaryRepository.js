// server/repositories/travelDiaryRepository.js
// ชั้นเข้าถึงฐานข้อมูลของ travel diary — ย้าย SQL ออกจาก travelDiaryController
const pool = require('../config/db');

// รายการบันทึกของผู้ใช้พร้อมชื่อสถานที่ตามภาษา ใหม่สุดก่อน
const findEntriesByUser = async (userId, language, db = pool) => {
    const { rows } = await db.query(
        `SELECT
            entry.external_id AS id,
            entry.started_at AS date,
            entry.last_seen_at,
            COALESCE(
                NULLIF(entry.title, ''),
                CASE WHEN $2 = 'th' THEN destination.name ELSE translation.name END,
                destination.name,
                ''
            ) AS title,
            entry.note,
            COALESCE(
                NULLIF(entry.province, ''),
                CASE WHEN $2 = 'th' THEN destination.province ELSE translation.province END,
                destination.province,
                ''
            ) AS province,
            COALESCE(
                NULLIF(entry.insight, ''),
                CASE WHEN $2 = 'th' THEN destination.description ELSE translation.description END,
                destination.description,
                ''
            ) AS insight,
            CASE
                WHEN jsonb_array_length(entry.image_urls) > 0 THEN entry.image_urls
                WHEN NULLIF(destination.image_url, '') IS NOT NULL
                    THEN jsonb_build_array(destination.image_url)
                ELSE '[]'::jsonb
            END AS image_urls,
            COALESCE(entry.latitude, destination.latitude) AS latitude,
            COALESCE(entry.longitude, destination.longitude) AS longitude,
            entry.destination_id,
            entry.source
         FROM travel_diary_entries entry
         LEFT JOIN destinations destination
            ON destination.id = entry.destination_id
         LEFT JOIN destination_translations translation
            ON translation.destination_id = destination.id
           AND translation.language_code = $2
         WHERE entry.user_id = $1
         ORDER BY entry.started_at DESC, entry.id DESC`,
        [userId, language],
    );
    return rows;
};

// เพิ่มหรืออัปเดตบันทึก (ชน user_id + external_id) คืน { id }
const upsertEntry = async (userId, entry, db = pool) => {
    const { rows } = await db.query(
        `INSERT INTO travel_diary_entries (
            external_id, user_id, destination_id, started_at, last_seen_at,
            title, note, province, insight, image_urls,
            latitude, longitude, source
         ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10::jsonb,
            $11, $12, $13
         )
         ON CONFLICT (user_id, external_id) DO UPDATE SET
            destination_id = EXCLUDED.destination_id,
            started_at = EXCLUDED.started_at,
            last_seen_at = EXCLUDED.last_seen_at,
            title = EXCLUDED.title,
            note = EXCLUDED.note,
            province = EXCLUDED.province,
            insight = EXCLUDED.insight,
            image_urls = EXCLUDED.image_urls,
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude,
            source = EXCLUDED.source,
            updated_at = NOW()
         RETURNING external_id AS id`,
        [
            entry.externalId,
            userId,
            entry.destinationId,
            entry.startedAt,
            entry.lastSeenAt,
            entry.title,
            entry.note,
            entry.province,
            entry.insight,
            JSON.stringify(entry.imageUrls),
            entry.latitude,
            entry.longitude,
            entry.source,
        ],
    );
    return rows[0];
};

// รูปทั้งหมดของ entry หนึ่ง (image_urls รวมรูปทุก sub อยู่แล้วฝั่ง client toJson)
const findEntryImageUrls = async (userId, externalId, db = pool) => {
    const { rows } = await db.query(
        `SELECT image_urls FROM travel_diary_entries
          WHERE user_id = $1 AND external_id = $2`,
        [userId, externalId],
    );
    const raw = rows[0]?.image_urls;
    if (!Array.isArray(raw)) return [];
    return raw.map((v) => `${v ?? ''}`).filter(Boolean);
};

// นับว่ามี diary entry ของผู้ใช้คนไหน (ยกเว้น entry ที่ระบุ) อ้างอิง URL นี้ไหม
// + รูปหลัก/แกลเลอรีของ destinations (asset ส่วนกลางห้ามลบเด็ดขาด)
const countUploadReferences = async (url, db = pool, exclude = null) => {
    const params = [url];
    let excludeClause = '';
    if (exclude != null && exclude.userId != null && exclude.externalId != null) {
        excludeClause = 'AND NOT (user_id = $2 AND external_id = $3)';
        params.push(exclude.userId, exclude.externalId);
    }
    const diary = await db.query(
        `SELECT COUNT(*)::int AS count FROM travel_diary_entries
          WHERE image_urls @> jsonb_build_array($1::text) ${excludeClause}`,
        params,
    );
    if ((diary.rows[0]?.count ?? 0) > 0) return diary.rows[0].count;
    const destMain = await db.query(
        `SELECT COUNT(*)::int AS count FROM destinations WHERE image_url = $1`,
        [url],
    );
    if ((destMain.rows[0]?.count ?? 0) > 0) return destMain.rows[0].count;
    const destGallery = await db.query(
        `SELECT COUNT(*)::int AS count FROM destination_images WHERE image_url = $1`,
        [url],
    );
    return destGallery.rows[0]?.count ?? 0;
};

// ลบบันทึก คืนจำนวนแถวที่ลบ
const deleteEntry = async (userId, externalId, db = pool) => {
    const result = await db.query(
        `DELETE FROM travel_diary_entries
         WHERE user_id = $1 AND external_id = $2`,
        [userId, externalId],
    );
    return result.rowCount;
};

module.exports = {
    findEntriesByUser,
    upsertEntry,
    deleteEntry,
    findEntryImageUrls,
    countUploadReferences,
};
