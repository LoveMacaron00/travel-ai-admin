// server/repositories/placeSearchRepository.js
// ชั้นเข้าถึงฐานข้อมูลของการค้นหาสถานที่ (RAG/keyword/nearby)
// ย้าย SQL ออกจาก services/ragHelper — service เหลือแค่ logic เลือกวิธีค้นหา
const pool = require('../config/db');

const destinationSelectFields = `
    d.id,
    d.name,
    d.province,
    d.description,
    d.category,
    d.tags,
    d.latitude,
    d.longitude,
    d.address,
    d.district,
    d.sub_district,
    d.postcode,
    COALESCE(
        d.image_url,
        (
            SELECT di.image_url
            FROM destination_images di
            WHERE di.destination_id = d.id
            ORDER BY di.id ASC
            LIMIT 1
        )
    ) AS image_url,
    d.opening_time,
    d.closing_time,
    d.opening_hours,
    d.tat_raw`;

// สถานที่ approved ตามตัวกรอง (ใช้เมื่อไม่มีคำค้น) ใหม่สุดก่อน
const findApprovedByFilter = async ({ province, categories, limit }, db = pool) => {
    const { rows } = await db.query(
        `SELECT ${destinationSelectFields},
                NULL::text AS chunk_text,
                'keyword_fallback'::text AS chunk_field,
                0::float AS similarity
         FROM destinations d
         WHERE d.status = 'approved'
           AND ($1::text IS NULL OR d.province = $1)
           AND ($2::text[] IS NULL OR d.category = ANY($2))
         ORDER BY d.created_at DESC
         LIMIT $3`,
        [province, categories, limit],
    );
    return rows;
};

// ค้นด้วยคะแนนคำตรง (fallback เมื่อ embedding ใช้ไม่ได้)
const searchByKeywords = async ({ terms, queryText, province, categories, limit }, db = pool) => {
    const { rows } = await db.query(
        `SELECT ${destinationSelectFields},
                NULL::text AS chunk_text,
                'keyword_fallback'::text AS chunk_field,
                matches.score::float AS similarity
         FROM destinations d
         CROSS JOIN LATERAL (
             SELECT COALESCE(SUM(
                 CASE WHEN COALESCE(d.name, '') ILIKE '%' || term || '%' THEN 8 ELSE 0 END
                 + CASE WHEN COALESCE(d.province, '') ILIKE '%' || term || '%' THEN 6 ELSE 0 END
                 + CASE WHEN COALESCE(d.category, '') ILIKE '%' || term || '%' THEN 4 ELSE 0 END
                 + CASE WHEN COALESCE(array_to_string(d.tags, ' '), '') ILIKE '%' || term || '%' THEN 3 ELSE 0 END
                 + CASE WHEN COALESCE(d.address, '') ILIKE '%' || term || '%' THEN 3 ELSE 0 END
                 + CASE WHEN COALESCE(d.district, '') ILIKE '%' || term || '%' THEN 3 ELSE 0 END
                 + CASE WHEN COALESCE(d.sub_district, '') ILIKE '%' || term || '%' THEN 3 ELSE 0 END
                 + CASE WHEN COALESCE(d.description, '') ILIKE '%' || term || '%' THEN 1 ELSE 0 END
                 + CASE WHEN EXISTS (
                     SELECT 1
                     FROM destination_translations dt
                     WHERE dt.destination_id = d.id
                       AND CONCAT_WS(' ', dt.name, dt.province, dt.address, dt.description)
                           ILIKE '%' || term || '%'
                 ) THEN 4 ELSE 0 END
             ), 0)
             + CASE
                 WHEN COALESCE(d.province, '') <> ''
                  AND $4::text ILIKE '%' || d.province || '%'
                 THEN 10 ELSE 0
               END AS score
             FROM unnest($1::text[]) AS term
         ) matches
         WHERE d.status = 'approved'
           AND ($2::text IS NULL OR d.province = $2)
           AND ($3::text[] IS NULL OR d.category = ANY($3))
           AND (matches.score > 0 OR $2::text IS NOT NULL)
         ORDER BY matches.score DESC, d.created_at DESC
         LIMIT $5`,
        [terms, province, categories, String(queryText || ''), limit],
    );
    return rows;
};

// ค้นด้วย similarity ของ embedding (limit เผื่อไว้ก่อน deduplicate)
const searchByVector = async ({ vectorJson, province, categories, limit }, db = pool) => {
    const { rows } = await db.query(
        `SELECT
            d.id,
            d.name,
            d.province,
            d.description,
            d.category,
            d.tags,
            d.latitude,
            d.longitude,
            d.address,
            d.district,
            d.sub_district,
            d.postcode,
            COALESCE(
                d.image_url,
                (
                    SELECT di.image_url
                    FROM destination_images di
                    WHERE di.destination_id = d.id
                    ORDER BY di.id ASC
                    LIMIT 1
                )
            ) AS image_url,
            d.opening_time,
            d.closing_time,
            d.opening_hours,
            d.tat_raw,
            pe.chunk_text,
            pe.chunk_field,
            1 - (pe.embedding <=> $1::vector) AS similarity
         FROM place_embeddings pe
         JOIN destinations d ON d.id = pe.destination_id
         WHERE d.status = 'approved'
           AND ($2::text IS NULL OR d.province = $2)
           AND ($3::text[] IS NULL OR d.category = ANY($3))
         ORDER BY pe.embedding <=> $1::vector
         LIMIT $4`,
        [vectorJson, province, categories, limit],
    );
    return rows;
};

// สถานที่ approved ใกล้พิกัดตามลำดับระยะทาง (Haversine)
const findNearby = async ({ latitude, longitude, limit }, db = pool) => {
    const { rows } = await db.query(
        `SELECT
            d.id, d.name, d.province, d.description, d.category, d.tags,
            d.latitude, d.longitude, d.address, d.district,
            d.sub_district, d.postcode,
            COALESCE(
                d.image_url,
                (
                    SELECT di.image_url
                    FROM destination_images di
                    WHERE di.destination_id = d.id
                    ORDER BY di.id ASC
                    LIMIT 1
                )
            ) AS image_url,
            d.opening_time, d.closing_time, d.opening_hours,
            d.tat_raw,
            (6371 * acos(LEAST(1, GREATEST(-1,
                cos(radians($1)) * cos(radians(d.latitude))
                * cos(radians(d.longitude) - radians($2))
                + sin(radians($1)) * sin(radians(d.latitude))
            )))) AS distance_km
         FROM destinations d
         WHERE d.status = 'approved'
           AND d.latitude IS NOT NULL
           AND d.longitude IS NOT NULL
         ORDER BY distance_km ASC, d.created_at DESC
         LIMIT $3`,
        [latitude, longitude, limit],
    );
    return rows;
};

// สถานที่ approved ตามรายการ id (คงลำดับที่ส่งมา)
const findByIds = async (ids, db = pool) => {
    const { rows } = await db.query(
        `SELECT ${destinationSelectFields},
                NULL::text AS chunk_text,
                'must_visit'::text AS chunk_field,
                1::float AS similarity
         FROM destinations d
         WHERE d.status = 'approved'
           AND d.id = ANY($1::int[])
         ORDER BY array_position($1::int[], d.id), d.created_at DESC`,
        [ids],
    );
    return rows;
};

// สถานที่ approved จากชื่อ (รองรับชื่อหลักและชื่อแปล) คืนแถวเดียวหรือ null
const findByNames = async (names, db = pool) => {
    const { rows } = await db.query(
        `SELECT
            d.id,
            d.name,
            COALESCE(
                d.image_url,
                (
                    SELECT di.image_url
                    FROM destination_images di
                    WHERE di.destination_id = d.id
                    ORDER BY di.id ASC
                    LIMIT 1
                )
            ) AS image_url
         FROM destinations d
         WHERE d.status = 'approved'
           AND (
                LOWER(REGEXP_REPLACE(BTRIM(d.name), '\\s+', ' ', 'g')) = ANY($1::text[])
                OR EXISTS (
                    SELECT 1
                    FROM destination_translations dt
                    WHERE dt.destination_id = d.id
                      AND LOWER(REGEXP_REPLACE(BTRIM(dt.name), '\\s+', ' ', 'g')) = ANY($1::text[])
                )
           )
         ORDER BY
            array_position(
                $1::text[],
                LOWER(REGEXP_REPLACE(BTRIM(d.name), '\\s+', ' ', 'g'))
            ) NULLS LAST,
            d.id DESC
         LIMIT 1`,
        [names],
    );
    return rows[0] || null;
};

module.exports = {
    findApprovedByFilter,
    searchByKeywords,
    searchByVector,
    findNearby,
    findByIds,
    findByNames,
};
