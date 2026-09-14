// server/scripts/backfillTatCovers.js
// Backfill รูปปก TAT ที่ยังเป็น URL remote (dmc.tatdataapi.io) มาเก็บ local /uploads/tat/
// วิธีใช้:
//   node scripts/backfillTatCovers.js --limit 50              (mirror จริง 50 แถวแรก)
//   node scripts/backfillTatCovers.js --limit 50 --dry-run    (ลิสต์เฉยๆ ไม่โหลด ไม่ UPDATE)
//   node scripts/backfillTatCovers.js --all                   (ทุกรายการ — ใช้เวลานาน ~20วิ/รูป)
//
// หมายเหตุ: TAT CDN TTFB ~20วิต่อรูป ควร run ทีละ batch (เช่น 50) ช่วงว่าง
// sync ใหม่หลังจากนี้จะ mirror อัตโนมัติผ่าน mirrorTatCoverImage ใน tatSyncService
const pool = require('../config/db');
const { mirrorTatCoverImage } = require('../services/tatSyncService');

const parseArgs = () => {
    const args = new Set(process.argv.slice(2));
    let limit = 50;
    const limitArg = process.argv.find((a) => a.startsWith('--limit='));
    if (limitArg) limit = Math.max(1, Number(limitArg.split('=')[1]) || 50);
    const limitIdx = process.argv.indexOf('--limit');
    if (limitIdx >= 0 && process.argv[limitIdx + 1]) {
        limit = Math.max(1, Number(process.argv[limitIdx + 1]) || 50);
    }
    return {
        dryRun: args.has('--dry-run'),
        all: args.has('--all'),
        limit,
    };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
    const { dryRun, all, limit } = parseArgs();
    console.log(`[backfill-tat] start — dryRun:${dryRun} ${all ? 'ALL rows' : `limit:${limit}`}`);

    const { rows } = await pool.query(
        `SELECT id, tat_place_id, image_url, images
         FROM destinations
         WHERE source = 'tat'
           AND image_url LIKE 'http%'
         ORDER BY id ASC
         ${all ? '' : 'LIMIT $1'}`,
        all ? [] : [limit],
    );
    console.log(`[backfill-tat] candidates: ${rows.length}`);

    if (dryRun) {
        for (const row of rows.slice(0, 20)) {
            console.log(`  - id=${row.id} tat=${row.tat_place_id} ${String(row.image_url).slice(0, 90)}`);
        }
        if (rows.length > 20) console.log(`  ... and ${rows.length - 20} more`);
        console.log('[backfill-tat] dry-run: no download, no UPDATE');
        return { total: rows.length, mirrored: 0, failed: 0, skipped: 0 };
    }

    let mirrored = 0;
    let failed = 0;
    let skipped = 0;
    for (const row of rows) {
        try {
            const result = await mirrorTatCoverImage(row.tat_place_id, row.image_url);
            if (!result || result === row.image_url) {
                skipped++;
                console.log(`[backfill-tat] skip id=${row.id} (mirror fallback remote)`);
            } else {
                // อัปเดต cover + JSON images + gallery ให้ชี้ local พร้อมกัน
                let images = row.images;
                if (typeof images === 'string') {
                    try { images = JSON.parse(images); } catch { images = []; }
                }
                if (Array.isArray(images)) {
                    images = images.map((img) =>
                        img && img.url === row.image_url ? { ...img, url: result } : img,
                    );
                }
                await pool.query(
                    `UPDATE destinations
                     SET image_url = $2, images = $3::jsonb, updated_at = NOW()
                     WHERE id = $1`,
                    [row.id, result, JSON.stringify(images ?? [])],
                );
                await pool.query(
                    `UPDATE destination_images SET image_url = $2
                     WHERE destination_id = $1 AND image_url = $3`,
                    [row.id, result, row.image_url],
                );
                mirrored++;
                console.log(`[backfill-tat] ✓ id=${row.id} -> ${result}`);
            }
        } catch (err) {
            failed++;
            console.error(`[backfill-tat] ✗ id=${row.id}:`, err.message);
        }
        await sleep(120);
    }

    const summary = { total: rows.length, mirrored, failed, skipped };
    console.log('[backfill-tat] done:', summary);
    return summary;
};

main()
    .catch((err) => {
        console.error('[backfill-tat] fatal:', err.message);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
