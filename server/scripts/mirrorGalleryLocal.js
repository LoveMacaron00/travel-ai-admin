// server/scripts/mirrorGalleryLocal.js — mirror รูป gallery (destination_images) ที่เป็น remote มาเก็บ local
// ใช้หลัง TAT sync ที่ mirror แค่รูปปก — gallery ที่เหลือเป็นลิงก์ dmc ตรง ๆ
// เก็บเป็น /uploads/tat/g-<destinationId>-r<rowId>.<ext> (กันชนชื่อกับไฟล์ cover <tatPlaceId>.<ext>)
//
// วิธีใช้:
//   node scripts/mirrorGalleryLocal.js --dry-run        (ลิสต์แผน ไม่แตะ DB ไม่โหลดไฟล์)
//   node scripts/mirrorGalleryLocal.js --only 176,177   (ทำจริงเฉพาะ destination id ที่ระบุ)
//   node scripts/mirrorGalleryLocal.js --limit 20       (ทำจริง 20 แถวแรก)
//   node scripts/mirrorGalleryLocal.js --all            (ทำจริงทั้งหมด)
const pool = require('../config/db');
const { config } = require('../config/env');
const fs = require('fs');
const path = require('path');
const { tatDir } = require('../config/storage');

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

const extByType = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
};

// ดาวน์โหลด remote URL มาเก็บ /uploads/tat/g-<destId>-r<rowId>.<ext>
// คีย์ด้วย row id ของ destination_images (ไม่ใช่ลำดับที่ในรอบนั้น) — กันไฟล์ชนกันข้ามรอบ:
// รอบก่อนเคยใช้ n ต่อ destination แล้ว exists-check คืนไฟล์เก่าของแถวอื่นให้ (เช่น 3809 ได้ g-176-1.jpg ของ 3808)
// คีย์ด้วย row id แล้ว exists-check จะเจอแค่ไฟล์ของแถวตัวเอง (crash recovery) ไม่ชนแถวอื่นเด็ดขาด
const mirrorGalleryOne = async (destId, rowId, remoteUrl) => {
    const trimmed = String(remoteUrl || '').trim();
    if (!trimmed || trimmed.startsWith('/uploads/') || !/^https?:\/\//i.test(trimmed)) return null;
    const baseName = `g-${destId}-r${rowId}`;
    for (const ext of ['.jpg', '.jpeg', '.png', '.webp', '.gif']) {
        try {
            if (fs.existsSync(path.join(tatDir, `${baseName}${ext}`))) {
                return `/uploads/tat/${baseName}${ext}`;
            }
        } catch { /* stat ล้มเหลวถือว่าไม่มีไฟล์ ไปโหลดใหม่ */ }
    }
    try {
        const upstream = await fetch(trimmed, {
            redirect: 'error',
            signal: AbortSignal.timeout(config.mediaProxy.timeoutMs),
            headers: { Accept: 'image/*', 'Accept-Encoding': 'identity', 'User-Agent': 'GoThai-Media-Proxy/1.0' },
        });
        if (!upstream.ok || !upstream.body) return null;
        const contentType = String(upstream.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
        const ext = extByType[contentType];
        if (!ext) return null;
        const buf = Buffer.from(await upstream.arrayBuffer());
        if (buf.length === 0 || buf.length > config.mediaProxy.maxBytes) return null;
        const filename = `${baseName}${ext}`;
        await fs.promises.writeFile(path.join(tatDir, filename), buf);
        return `/uploads/tat/${filename}`;
    } catch (err) {
        console.error(`[mirror-gallery] dest=${destId} r${rowId} failed:`, err.message.slice(0, 60));
        return null;
    }
};

const main = async () => {
    const { dryRun, all, limit, only } = parseArgs();
    const scope = only ? `only:${only.length} ids` : (all || !limit ? 'ALL rows' : `limit:${limit}`);
    console.log(`[mirror-gallery] start — dryRun:${dryRun} ${scope}`);

    const params = [];
    let whereExtra = '';
    if (only) {
        params.push(only);
        whereExtra = `AND di.destination_id = ANY($${params.length}::int[])`;
    }
    let limitClause = '';
    if (!only && !all && limit) {
        params.push(limit);
        limitClause = `LIMIT $${params.length}`;
    }
    const { rows } = await pool.query(
        `SELECT di.id, di.destination_id, di.image_url
         FROM destination_images di
         WHERE di.image_url LIKE 'http%'
           ${whereExtra}
         ORDER BY di.destination_id ASC, di.id ASC
         ${limitClause}`,
        params,
    );
    console.log(`[mirror-gallery] candidates: ${rows.length}`);

    let mirrored = 0, failed = 0;
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (dryRun) {
            mirrored++;
            continue;
        }
        // คีย์ไฟล์ด้วย row id — ไม่ใช้ลำดับที่ต่อ destination (กัน exists-check คืนไฟล์แถวอื่น)
        const local = await mirrorGalleryOne(row.destination_id, row.id, row.image_url);
        if (local) {
            await pool.query('UPDATE destination_images SET image_url = $2 WHERE id = $1', [row.id, local]);
            // images JSONB ของ destinations แถวนั้นชี้ URL เดิมอยู่ก็อัปเดตตาม
            // COALESCE กันกรณี images เป็น [] (jsonb_agg บน 0 แถวคืน NULL)
            await pool.query(
                `UPDATE destinations SET images = COALESCE((
                    SELECT jsonb_agg(CASE WHEN (v->>'url') = $2::text THEN v || jsonb_build_object('url', $3::text) ELSE v END)
                    FROM jsonb_array_elements(images) v
                 ), '[]'::jsonb),
                 updated_at = NOW() WHERE id = $1 AND images IS NOT NULL`,
                [row.destination_id, row.image_url, local],
            );
            mirrored++;
            if (mirrored % 50 === 0) console.log(`[mirror-gallery] progress mirrored=${mirrored}/${rows.length}`);
        } else {
            failed++;
        }
        await sleep(120);
    }

    console.log(`[mirror-gallery] done${dryRun ? ' (dry-run)' : ''}: mirrored=${mirrored} failed=${failed}`);
};

main()
    .catch((err) => {
        console.error('[mirror-gallery] fatal:', err.message);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
