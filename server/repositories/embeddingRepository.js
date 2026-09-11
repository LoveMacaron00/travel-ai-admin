// server/repositories/embeddingRepository.js
// ชั้นเข้าถึงฐานข้อมูลของ place embeddings — ย้าย SQL ออกจาก services/embedHelper
const pool = require('../config/db');

// สถานที่ approved พร้อมฟิลด์สำหรับสร้าง embedding คืนแถวหรือ null
const findEmbeddableDestination = async (destinationId, db = pool) => {
    const { rows } = await db.query(
        `SELECT id, name, province, description, category, tags,
                latitude, longitude, address, district, sub_district, postcode,
                opening_time, closing_time,
                opening_hours, tat_raw
         FROM destinations WHERE id = $1 AND status = 'approved'`,
        [destinationId],
    );
    return rows[0] || null;
};

// แทนที่ embedding ทั้งหมดของสถานที่ใน transaction เดียว
// chunks = [{ text, field, vector }]
const replaceDestinationEmbeddings = async (destinationId, chunks) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM place_embeddings WHERE destination_id = $1', [destinationId]);
        for (const chunk of chunks) {
            await client.query(
                `INSERT INTO place_embeddings (destination_id, chunk_text, chunk_field, embedding)
                 VALUES ($1, $2, $3, $4::vector)`,
                [destinationId, chunk.text, chunk.field, JSON.stringify(chunk.vector)],
            );
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

// id ของสถานที่ approved ที่ยังไม่มี embedding เรียงตาม id
const findApprovedWithoutEmbeddings = async (db = pool) => {
    const { rows } = await db.query(
        `SELECT d.id FROM destinations d
         WHERE d.status = 'approved'
           AND NOT EXISTS (
               SELECT 1 FROM place_embeddings pe WHERE pe.destination_id = d.id
           )
         ORDER BY d.id ASC`,
    );
    return rows;
};

// ลบ embedding ทั้งหมดของสถานที่
const deleteDestinationEmbeddings = async (destinationId, db = pool) => {
    await db.query('DELETE FROM place_embeddings WHERE destination_id = $1', [destinationId]);
};

module.exports = {
    findEmbeddableDestination,
    replaceDestinationEmbeddings,
    findApprovedWithoutEmbeddings,
    deleteDestinationEmbeddings,
};
