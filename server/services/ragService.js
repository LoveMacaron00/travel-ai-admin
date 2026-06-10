// =============================================================
// ragService.js — vector search สำหรับ RAG
// =============================================================
// หน้าที่: รับ query text → embed → cosine search ใน pgvector
//          คืน top-k destinations พร้อม chunk_text สำหรับ inject prompt
// =============================================================

const { query } = require('../db');
const { getEmbedding } = require('./embedService');

// -------------------------------------------------------------
// ค้นหา destinations ที่เกี่ยวข้องกับ query
// options: { province, categories, limit }
// -------------------------------------------------------------
async function retrieveRelevantPlaces(queryText, options = {}) {
    const {
        province   = null,
        categories = null, // string[] เช่น ['restaurant','attraction']
        limit      = 10,
    } = options;

    // embed คำถาม
    const queryVector = await getEmbedding(queryText);

    // vector search + filter
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
            d.image_url,
            d.opening_time,
            d.closing_time,
            d.price_adult,
            d.avg_rating,
            pe.chunk_text,
            pe.chunk_field,
            1 - (pe.embedding <=> $1::vector) AS similarity
         FROM place_embeddings pe
         JOIN destinations d ON d.id = pe.destination_id
         WHERE d.status = 'approved'
           AND ($2::text    IS NULL OR d.province  = $2)
           AND ($3::text[]  IS NULL OR d.category  = ANY($3))
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

// -------------------------------------------------------------
// format places เป็น context string สำหรับ inject ใน Gemini prompt
// -------------------------------------------------------------
function formatPlacesContext(places) {
    if (places.length === 0) return 'ไม่พบสถานที่ที่เกี่ยวข้องในฐานข้อมูล';

    return places.map((p, i) =>
        `[${i + 1}] ${p.name}
จังหวัด: ${p.province || '-'} | หมวดหมู่: ${p.category} | คะแนน: ${p.avg_rating || '-'}
${p.description ? p.description.replace(/<[^>]*>/g, '').slice(0, 300) : ''}
แท็ก: ${(p.tags || []).join(', ') || '-'}
${p.price_adult ? `ค่าเข้าชม: ผู้ใหญ่ ${p.price_adult} บาท` : ''}
${p.opening_time && p.opening_time !== '00:00' ? `เวลาทำการ: ${p.opening_time} - ${p.closing_time}` : ''}`
    ).join('\n\n---\n\n');
}

module.exports = { retrieveRelevantPlaces, formatPlacesContext };
