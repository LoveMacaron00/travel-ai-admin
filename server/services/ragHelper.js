// server/services/ragHelper.js

const { getEmbedding } = require('./embedHelper');
const { stripHtml, buildPlaceFacts } = require('./tatPlaceFormatter');
const placeSearchRepository = require('../repositories/placeSearchRepository');

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

// สำรองการค้นหาแบบข้อความเมื่อบริการ embedding ใช้งานไม่ได้หรือโควตาหมด
async function retrievePlacesByText(queryText, options = {}) {
    const {
        province = null,
        categories = null,
        limit = 10,
    } = options;
    const terms = getFallbackSearchTerms(queryText);

    if (terms.length === 0) {
        return placeSearchRepository.findApprovedByFilter({ province, categories, limit });
    }

    return placeSearchRepository.searchByKeywords({
        terms,
        queryText,
        province,
        categories,
        limit,
    });
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
    const rows = await placeSearchRepository.searchByVector({
        vectorJson: JSON.stringify(queryVector),
        province,
        categories,
        limit: limit * 3, // ดึงเผื่อไว้ก่อน deduplicate
    });

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

    return placeSearchRepository.findNearby({ latitude: lat, longitude: lng, limit });
}

async function retrievePlacesByIds(ids) {
    const normalizedIds = [...new Set(
        (Array.isArray(ids) ? ids : [])
            .map((id) => Number.parseInt(String(id), 10))
            .filter((id) => Number.isInteger(id) && id > 0),
    )];
    if (normalizedIds.length === 0) return [];

    return placeSearchRepository.findByIds(normalizedIds);
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

    return placeSearchRepository.findByNames(normalizedNames);
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
    retrievePlacesByIds,
    retrievePlacesByText,
    retrieveRelevantPlaces,
};
