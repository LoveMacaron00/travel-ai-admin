// server/services/embedHelper.js

const { config } = require('../config/env');
const embeddingRepository = require('../repositories/embeddingRepository');
const GEMINI_API_KEY = config.gemini.apiKey;
const GEMINI_API_BASE = config.gemini.apiBaseUrl;
const EMBED_MODEL = config.gemini.embeddingModel;
const EMBED_DIMENSIONS = 1536;
const { stripHtml, buildPlaceFacts } = require('./tatPlaceFormatter');

// taskType ต้องต่างกันระหว่างเอกสารกับคำค้นตามสัญญาของ embedding model
// ขอเวกเตอร์ embedding จาก Gemini สำหรับข้อความและประเภทงานที่กำหนด
async function getEmbedding(text, taskType = 'RETRIEVAL_DOCUMENT') {
    if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
        throw new Error('ไม่ได้ตั้งค่า GEMINI_API_KEY ในระบบ (.env)');
    }

    const response = await fetch(`${GEMINI_API_BASE}/models/${EMBED_MODEL}:embedContent`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': GEMINI_API_KEY,
        },
        body: JSON.stringify({
            taskType,
            outputDimensionality: EMBED_DIMENSIONS,
            content: {
                parts: [{ text }],
            },
        }),
    });
    if (!response.ok) {
        const error = new Error(`Gemini embedding error: ${response.status} — ${await response.text()}`);
        error.status = response.status;
        throw error;
    }

    const data = await response.json();
    const values = data.embedding?.values;
    if (!Array.isArray(values) || values.length !== EMBED_DIMENSIONS) {
        throw new Error(`Gemini embedding returned invalid vector size: ${values?.length || 0}`);
    }
    return values;
}

// รวมข้อมูลสำคัญทั้งหมดเป็นเอกสารเดียว เพื่อลด Gemini quota เหลือหนึ่ง request ต่อสถานที่
function buildChunks(dest) {
    const facts = buildPlaceFacts(dest);

    return [
        {
            field: 'destination',
            text: [
                `ชื่อสถานที่: ${dest.name}`,
                `หมวดหมู่: ${dest.category}`,
                dest.tags?.length ? `แท็ก: ${dest.tags.join(', ')}` : '',
                facts.detailText || (dest.description ? stripHtml(dest.description).slice(0, 1600) : ''),
                dest.address ? `ที่อยู่: ${dest.address}` : '',
                dest.sub_district ? `ตำบล/แขวง: ${dest.sub_district}` : '',
                dest.district ? `อำเภอ/เขต: ${dest.district}` : '',
                dest.province ? `จังหวัด: ${dest.province}` : '',
                dest.postcode ? `รหัสไปรษณีย์: ${dest.postcode}` : '',
                (dest.latitude && dest.longitude) ? `พิกัด ${dest.latitude}, ${dest.longitude}` : '',
                facts.feeText ? `ค่าเข้าชม: ${facts.feeText}` : '',
                facts.openingHoursText ? `เวลาทำการ: ${facts.openingHoursText}` : '',
                facts.contactText ? `ติดต่อ: ${facts.contactText}` : '',
            ].filter(Boolean).join('\n'),
        },
    ];
}

// สร้างและบันทึก embedding ใหม่ของสถานที่หนึ่งแห่ง
async function embedDestination(destinationId) {
    const dest = await embeddingRepository.findEmbeddableDestination(destinationId);
    if (!dest) {
        console.log(`[embed] skip: destination ${destinationId} ไม่พบหรือยังไม่ approved`);
        return false;
    }
    const chunks = buildChunks(dest);
    const embeddedChunks = [];
    for (const chunk of chunks) {
        if (!chunk.text.trim()) continue;
        const vector = await getEmbedding(chunk.text, 'RETRIEVAL_DOCUMENT');
        embeddedChunks.push({ ...chunk, vector });
    }

    // ขอเวกเตอร์ให้ครบก่อนลบชุดเก่า เพื่อไม่ให้ quota/network error
    // ทำให้สถานที่ที่เคยค้นหาได้สูญเสีย embedding เดิม
    await embeddingRepository.replaceDestinationEmbeddings(destinationId, embeddedChunks);
    console.log(`[embed] ✓ ${dest.name} (id:${destinationId}) — ${embeddedChunks.length} chunks`);
    return true;
}

// สร้าง embedding ให้สถานที่ approved ทุกแห่งที่ยังไม่มีข้อมูล
async function bulkEmbedMissing() {
    const rows = await embeddingRepository.findApprovedWithoutEmbeddings();
    console.log(`[embed] bulk: พบ ${rows.length} destinations ที่ยังไม่ได้ embed`);
    let success = 0;
    let failed = 0;
    let quotaExhausted = false;
    for (const row of rows) {
        try {
            await embedDestination(row.id);
            success++;
            await new Promise(r => setTimeout(r, 120));
        } catch (err) {
            failed++;
            console.error(`[embed] ✗ destination ${row.id}:`, err.message);
            if (err.status === 429) {
                quotaExhausted = true;
                console.error('[embed] หยุดคิวชั่วคราวเพราะ Gemini quota เต็ม');
                break;
            }
        }
    }
    const remaining = rows.length - success - failed;
    const summary = { total: rows.length, success, failed, remaining, quotaExhausted };
    console.log('[embed] bulk done:', summary);
    return summary;
}

// ลบ embedding เดิมของสถานที่เพื่อเตรียมสร้างใหม่
async function clearDestinationEmbedding(destinationId) {
    await embeddingRepository.deleteDestinationEmbeddings(destinationId);
}

module.exports = { getEmbedding, embedDestination, bulkEmbedMissing, clearDestinationEmbedding };
