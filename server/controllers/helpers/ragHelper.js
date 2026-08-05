// server/controllers/helpers/ragHelper.js

const pool = require('../../config/db');
const query = pool.query.bind(pool);
const { getEmbedding } = require('./embedHelper');
const { stripHtml, buildPlaceFacts } = require('./tatPlaceFormatter');

const FALLBACK_STOP_WORDS = new Set([
    'ขอ', 'ช่วย', 'หา', 'แนะนำ', 'อยาก', 'เที่ยว', 'ไป', 'ที่', 'ใน', 'มี', 'ไหม',
    'อะไร', 'บ้าง', 'ครับ', 'ค่ะ', 'ให้', 'หน่อย', 'และ', 'หรือ', 'ของ', 'จาก',
    'please', 'find', 'show', 'recommend', 'travel', 'trip', 'in', 'at', 'the', 'a', 'an',
]);

// ตัดคำทั่วไปออกเพื่อให้ fallback จับชื่อ จังหวัด หมวดหมู่ และความสนใจได้แม่นขึ้น
const getFallbackSearchTerms = (queryText) => [...new Set(
    String(queryText || '')
        .toLowerCase()
        .split(/[\s,./\\|()[\]{}:;!?"']+/u)
        .map(term => term.trim())
        .filter(term => term.length > 1 && !FALLBACK_STOP_WORDS.has(term))
        .slice(0, 12),
)];

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

// สำรองการค้นหาแบบข้อความเมื่อบริการ embedding ใช้งานไม่ได้หรือโควตาหมด
async function retrievePlacesByText(queryText, options = {}) {
    const {
        province = null,
        categories = null,
        limit = 10,
    } = options;
    const terms = getFallbackSearchTerms(queryText);

    if (terms.length === 0) {
        const { rows } = await query(
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
    }

    const { rows } = await query(
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
}

// Semantic retrieval สำหรับคำถามที่ไม่มีพิกัด พร้อม filter จังหวัด/หมวดหมู่
// ค้นหาสถานที่ที่เกี่ยวข้องกับข้อความด้วย similarity ของ embedding
async function retrieveRelevantPlaces(queryText, options = {}) {
    const {
        province = null,
        categories = null, // string[] เช่น ['restaurant','attraction']
        limit = 10,
    } = options;

    // embed คำถาม; หาก Gemini embedding ขัดข้องให้ใช้ PostgreSQL text fallback
    let queryVector;
    try {
        queryVector = await getEmbedding(queryText, 'RETRIEVAL_QUERY');
    } catch (error) {
        console.warn(`[rag] embedding unavailable; using text fallback: ${error.message}`);
        return retrievePlacesByText(queryText, { province, categories, limit });
    }

    // ค้นหาเวกเตอร์และกรองผลลัพธ์
    const { rows } = await query(
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
        [
            JSON.stringify(queryVector),
            province,
            categories,
            limit * 3, // ดึงเผื่อไว้ก่อน deduplicate
        ]
    );

    // deduplicate — อาจได้ place เดิมหลาย rows จากหลาย chunk fields
    const seen = new Set();
    const places = [];
    for (const row of rows) {
        if (!seen.has(row.id)) {
            seen.add(row.id);
            places.push(row);
            if (places.length >= limit) break;
        }
    }

    return places;
}

// เมื่อมี GPS ให้ค้นด้วย Haversine ก่อน เพื่อไม่ให้การสร้างแผนผูกกับ embedding API
// ค้นหาสถานที่ approved ที่อยู่ใกล้พิกัดตามลำดับระยะทาง
async function retrieveNearbyPlaces(latitude, longitude, limit = 15) {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

    const { rows } = await query(
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
        [lat, lng, limit],
    );
    return rows;
}

// ค้นสถานที่ approved จากชื่อที่ AI ระบุ รองรับชื่อหลักและชื่อแปล
async function findDestinationByNames(names) {
    const normalizedNames = [...new Set(
        names
            .flatMap((name) => {
                const value = String(name || '').trim();
                if (!value) return [];
                const parentheticalNames = [...value.matchAll(/\(([^)]+)\)/g)]
                    .map((match) => match[1]);
                return [
                    value,
                    value.replace(/\s*\([^)]*\)\s*/g, ' ').trim(),
                    ...parentheticalNames,
                ];
            })
            .map((name) => name.toLowerCase().replace(/\s+/g, ' ').trim())
            .filter(Boolean),
    )];
    if (normalizedNames.length === 0) return null;

    const { rows } = await query(
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
        [normalizedNames],
    );
    return rows[0] || null;
}

// ส่งเฉพาะ facts ที่ผ่าน formatter เข้า prompt เพื่อลด HTML และ schema ของ TAT ที่แกว่ง
// แปลงผลลัพธ์สถานที่เป็น context ข้อความสำหรับ prompt ของ AI
function formatPlacesContext(places) {
    if (places.length === 0) return 'ไม่พบสถานที่ที่เกี่ยวข้องในฐานข้อมูล';

    return places.map((p, i) => {
        const facts = buildPlaceFacts(p);

        return `[${i + 1}] ${p.name}
    รหัสสถานที่: ${p.id}
    จังหวัด: ${p.province || '-'} | หมวดหมู่: ${p.category}
    ที่อยู่: ${p.address || '-'}
    ตำบล/แขวง: ${p.sub_district || '-'} | อำเภอ/เขต: ${p.district || '-'} | รหัสไปรษณีย์: ${p.postcode || '-'}
    ${facts.detailText || (p.description ? stripHtml(p.description).slice(0, 300) : '')}
    แท็ก: ${(p.tags || []).join(', ') || '-'}
    ${facts.openingHoursText ? `เวลาเปิด-ปิด: ${facts.openingHoursText}` : ''}
    ${facts.feeText ? `ค่าเข้าชม: ${facts.feeText}` : ''}
    พิกัด: ${p.latitude || '-'}, ${p.longitude || '-'}
    รูปภาพ: ${p.image_url || '-'}
    ${facts.contactText ? `เบอร์ติดต่อ: ${facts.contactText}` : ''}`;
    }).join('\n\n---\n\n');
}

module.exports = {
    findDestinationByNames,
    formatPlacesContext,
    retrieveNearbyPlaces,
    retrievePlacesByText,
    retrieveRelevantPlaces,
};
