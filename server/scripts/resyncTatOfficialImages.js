// server/scripts/resyncTatOfficialImages.js — sync รูป official TAT กลับมาทับรูป wiki
// ใช้เมื่อ dmc.tatdataapi.io กลับมาใช้ได้แล้วเท่านั้น (probe ก่อนเสมอ)
//
// วิธีใช้:
//   node scripts/resyncTatOfficialImages.js --dry-run        (ลิสต์แผน ไม่แตะ DB ไม่โหลดไฟล์)
//   node scripts/resyncTatOfficialImages.js --only 33899,33898 (ทำจริงเฉพาะ id ที่ระบุ)
//   node scripts/resyncTatOfficialImages.js --limit 10       (ทำจริง 10 แถวแรก)
//   node scripts/resyncTatOfficialImages.js --all            (ทำจริงทั้งหมด)
//
// พฤติกรรมต่อแถว: detail TH (hydrate) → normalize cover → mirror /uploads/tat/<tatPlaceId>.<ext>
// → UPDATE cover+images JSONB+gallery เฉพาะแถวที่ mirror สำเร็จ (ล้มเหลว = คง wiki ไม่ทับ)
// หมายเหตุ: dmc ตอบ ~0.3-0.5วิ/รูปตอนปกติ — 246 แถว ≈ 40-60 นาที (detail + EN + mirror)
const pool = require('../config/db');
const { fetchTATPlaceDetail, syncOneTATPlace } = require('../services/tatSyncService');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const parseArgs = () => {
    const args = new Set(process.argv.slice(2));
    const numAfter = (flag) => {
        const i = process.argv.indexOf(flag);
        return i >= 0 && process.argv[i + 1] ? Math.max(1, Number(process.argv[i + 1]) || 0) : 0;
    };
    let only = null;
    const i = process.argv.indexOf('--only');
    if (i >= 0 && process.argv[i + 1]) {
        only = process.argv[i + 1].split(',').map((s) => Number(s.trim())).filter(Number.isFinite);
        if (!only.length) only = null;
    }
    return { dryRun: args.has('--dry-run'), all: args.has('--all'), limit: numAfter('--limit'), only };
};

const main = async () => {
    const { dryRun, all, limit, only } = parseArgs();
    const scope = only ? `only:${only.length} ids` : (all || !limit ? 'ALL rows' : `limit:${limit}`);
    console.log(`[resync-tat] start — dryRun:${dryRun} ${scope}`);

    const params = [];
    let whereExtra = '';
    if (only) {
        params.push(only);
        whereExtra = `AND id = ANY($${params.length}::int[])`;
    }
    let limitClause = '';
    if (!only && !all && limit) {
        params.push(limit);
        limitClause = `LIMIT $${params.length}`;
    }
    const { rows } = await pool.query(
        `SELECT id, tat_place_id, image_url
         FROM destinations
         WHERE image_url LIKE '/uploads/wiki/%'
           AND tat_place_id IS NOT NULL
           ${whereExtra}
         ORDER BY id ASC
         ${limitClause}`,
        params,
    );
    console.log(`[resync-tat] candidates: ${rows.length}`);

    let resynced = 0, kept = 0, failed = 0;
    const keptNames = [];
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const before = row.image_url;
        try {
            if (dryRun) {
                // dry-run: ดูแค่ thumb จาก detail ไม่แตะ DB ไม่โหลดไฟล์
                const detail = await fetchTATPlaceDetail(row.tat_place_id, 'th');
                const thumb = Array.isArray(detail?.thumbnailUrl) ? detail.thumbnailUrl[0] : detail?.thumbnailUrl;
                console.log(`  [${row.id}] plan tat=${row.tat_place_id} thumb=${String(thumb).slice(0, 70)}`);
                resynced++;
            } else {
                // syncOneTATPlace ตัวเดียวกับปุ่ม sync (detail TH + mirror /uploads/tat/ + EN)
                await syncOneTATPlace(row.tat_place_id);
                // ตรวจว่า cover ใหม่อยู่บน /uploads/tat/ จริง ไม่ใช่ fallback dmc ที่ตาย
                const { rows: check } = await pool.query(
                    'SELECT image_url FROM destinations WHERE id = $1',
                    [row.id],
                );
                const newCover = String(check[0]?.image_url || '');
                if (newCover.startsWith('/uploads/tat/')) {
                    resynced++;
                    console.log(`  [${row.id}] ✓ tat=${row.tat_place_id} -> ${newCover}`);
                } else {
                    // mirror ล้มเหลวได้ dmc กลับมา — คืน wiki เดิม กันรูปพัง
                    await pool.query(
                        'UPDATE destinations SET image_url = $2, updated_at = NOW() WHERE id = $1',
                        [row.id, before],
                    );
                    kept++;
                    keptNames.push(`${row.id} tat=${row.tat_place_id} (mirror fail, restored wiki)`);
                    console.log(`  [${row.id}] KEEP wiki (mirror fail: ${newCover.slice(0, 60)})`);
                }
            }
        } catch (err) {
            failed++;
            console.error(`  [${row.id}] FAIL:`, err.message.slice(0, 100));
        }
        if ((i + 1) % 20 === 0) console.log(`[resync-tat] progress ${i + 1}/${rows.length}`);
        await sleep(500);
    }

    console.log(`[resync-tat] done${dryRun ? ' (dry-run)' : ''}: resynced=${resynced} kept=${kept} failed=${failed}`);
    if (keptNames.length) {
        console.log('[resync-tat] kept (wiki untouched):');
        for (const n of keptNames) console.log(`  KEEP ${n}`);
    }
};

main()
    .catch((err) => {
        console.error('[resync-tat] fatal:', err.message);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
