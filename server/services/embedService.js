const { query } = require('../db');
const { OPENAI_API_KEY, EMBED_MODEL } = require('../config/env');

async function getEmbedding(text) {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: EMBED_MODEL, input: text }),
    });
    if (!response.ok) throw new Error(`OpenAI error: ${response.status} — ${await response.text()}`);
    return (await response.json()).data[0].embedding;
}

function buildChunks(dest) {
    return [
        {
            field: 'name_tags',
            text: [
                `ชื่อสถานที่: ${dest.name}`,
                `หมวดหมู่: ${dest.category}`,
                dest.tags?.length ? `แท็ก: ${dest.tags.join(', ')}` : '',
                dest.province     ? `จังหวัด: ${dest.province}`       : '',
            ].filter(Boolean).join('\n'),
        },
        {
            field: 'description',
            text: [
                dest.name,
                dest.description ? dest.description.replace(/<[^>]*>/g, '').slice(0, 800) : '',
            ].filter(Boolean).join('\n'),
        },
        {
            field: 'location_context',
            text: [
                `${dest.name} ตั้งอยู่`,
                dest.address     ? `ที่อยู่: ${dest.address}`                         : '',
                dest.province    ? `จังหวัด${dest.province}`                          : '',
                (dest.latitude && dest.longitude) ? `พิกัด ${dest.latitude}, ${dest.longitude}` : '',
                `หมวดหมู่: ${dest.category}`,
                dest.price_adult ? `ค่าเข้าชมผู้ใหญ่ ${dest.price_adult} บาท`        : '',
                (dest.opening_time && dest.opening_time !== '00:00')
                    ? `เปิด ${dest.opening_time} - ${dest.closing_time}` : '',
            ].filter(Boolean).join(' '),
        },
    ];
}

async function embedDestination(destinationId) {
    const { rows } = await query(
        `SELECT id, name, province, description, category, tags,
                latitude, longitude, address, opening_time, closing_time, price_adult
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
        const vector = await getEmbedding(chunk.text);
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

module.exports = { getEmbedding, embedDestination, bulkEmbedMissing, buildChunks };
