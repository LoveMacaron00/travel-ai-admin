const pool = require('../../config/db');
const query = pool.query.bind(pool);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const EMBED_MODEL = 'gemini-embedding-001';
const EMBED_DIMENSIONS = 1536;
const { stripHtml, buildPlaceFacts } = require('./tatPlaceFormatter');

async function getEmbedding(text, taskType = 'RETRIEVAL_DOCUMENT') {
    if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') {
        throw new Error('ไม่ได้ตั้งค่า GEMINI_API_KEY ในระบบ (.env)');
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`, {
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
    if (!response.ok) throw new Error(`Gemini embedding error: ${response.status} — ${await response.text()}`);

    const data = await response.json();
    const values = data.embedding?.values;
    if (!Array.isArray(values) || values.length !== EMBED_DIMENSIONS) {
        throw new Error(`Gemini embedding returned invalid vector size: ${values?.length || 0}`);
    }
    return values;
}

function buildChunks(dest) {
    const facts = buildPlaceFacts(dest);

    return [
        {
            field: 'name_tags',
            text: [
                `ชื่อสถานที่: ${dest.name}`,
                `หมวดหมู่: ${dest.category}`,
                dest.tags?.length ? `แท็ก: ${dest.tags.join(', ')}` : '',
                dest.province     ? `สถานที่ตั้ง: ${dest.province}`   : '',
            ].filter(Boolean).join('\n'),
        },
        {
            field: 'description',
            text: [
                dest.name,
                facts.detailText || (dest.description ? stripHtml(dest.description).slice(0, 800) : ''),
            ].filter(Boolean).join('\n'),
        },
        {
            field: 'location_context',
            text: [
                `${dest.name} ตั้งอยู่`,
                dest.address     ? `ที่อยู่: ${dest.address}`                         : '',
                dest.province    ? `สถานที่ตั้ง: ${dest.province}`                    : '',
                (dest.latitude && dest.longitude) ? `พิกัด ${dest.latitude}, ${dest.longitude}` : '',
                `หมวดหมู่: ${dest.category}`,
                facts.feeText ? `ค่าเข้าชม: ${facts.feeText}` : '',
                facts.openingHoursText ? `เวลาทำการ: ${facts.openingHoursText}` : '',
                facts.contactText ? `ติดต่อ: ${facts.contactText}` : '',
            ].filter(Boolean).join(' '),
        },
    ];
}

async function embedDestination(destinationId) {
    const { rows } = await query(
        `SELECT id, name, province, description, category, tags,
                latitude, longitude, address, opening_time, closing_time,
                opening_hours, price_adult, price_child, tat_raw
         FROM destinations WHERE id = $1 AND status = 'approved'`,
        [destinationId]
    );
    if (rows.length === 0) {
        console.log(`[embed] skip: destination ${destinationId} ไม่พบหรือยังไม่ approved`);
        return false;
    }
    const dest = rows[0];
    const chunks = buildChunks(dest);

    await query('DELETE FROM place_embeddings WHERE destination_id = $1', [destinationId]);

    for (const chunk of chunks) {
        if (!chunk.text.trim()) continue;
        const vector = await getEmbedding(chunk.text, 'RETRIEVAL_DOCUMENT');
        await query(
            `INSERT INTO place_embeddings (destination_id, chunk_text, chunk_field, embedding)
             VALUES ($1, $2, $3, $4::vector)`,
            [destinationId, chunk.text, chunk.field, JSON.stringify(vector)]
        );
    }
    console.log(`[embed] ✓ ${dest.name} (id:${destinationId}) — ${chunks.length} chunks`);
    return true;
}

async function bulkEmbedMissing() {
    const { rows } = await query(
        `SELECT d.id FROM destinations d
         LEFT JOIN place_embeddings pe ON pe.destination_id = d.id
         WHERE d.status = 'approved' AND pe.id IS NULL`
    );
    console.log(`[embed] bulk: พบ ${rows.length} destinations ที่ยังไม่ได้ embed`);
    let success = 0, failed = 0;
    for (const row of rows) {
        try {
            await embedDestination(row.id);
            success++;
            await new Promise(r => setTimeout(r, 120));
        } catch (err) {
            failed++;
            console.error(`[embed] ✗ destination ${row.id}:`, err.message);
        }
    }
    console.log(`[embed] bulk done — success:${success} failed:${failed}`);
    return { success, failed };
}

async function clearDestinationEmbedding(destinationId) {
    await query('DELETE FROM place_embeddings WHERE destination_id = $1', [destinationId]);
}

module.exports = { getEmbedding, embedDestination, bulkEmbedMissing, clearDestinationEmbedding, buildChunks };
