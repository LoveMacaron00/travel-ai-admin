// POST /api/admin/embed/bulk       — embed ทุก approved ที่ยังไม่มี vector
// POST /api/admin/embed/:id        — re-embed destination เดียว
// POST /api/admin/sync/tat         — trigger TAT sync

const pool = require('../config/db');
const query = pool.query.bind(pool);
const { embedDestination, bulkEmbedMissing } = require('./helpers/embedHelper');

const TAT_API_KEY = process.env.TATDATAAPI;
const TAT_API_BASE = 'https://tatdataapi.io/api/v2';
const TAT_HEADERS  = { 'x-api-key': TAT_API_KEY, 'Accept-Language': 'th' };

const CATEGORY_MAP = {
    'สถานที่ท่องเที่ยว' : 'attraction',
    'ที่พัก'            : 'hotel',
    'ร้านอาหาร'         : 'restaurant',
    'ร้านค้า'           : 'shop',
    'บริการนักท่องเที่ยว': 'service',
    'กิจกรรม'           : 'activity',
};
const mapCategory = c => CATEGORY_MAP[c] ?? 'general';

async function fetchTATPage(page, limit = 100, keyword = '', province = '', placeCategory = '') {
    if (!TAT_API_KEY || TAT_API_KEY === 'your_tat_api_key_here') {
        throw new Error('ไม่ได้ตั้งค่า TAT API Key ในระบบ (.env)');
    }
    const params = new URLSearchParams({ numberOfResult: limit, page,
        ...(keyword       && { keyword }),
        ...(province      && { provinceName: province }),
        ...(placeCategory && { place_category: placeCategory }) });
    const res = await fetch(`${TAT_API_BASE}/places?${params}`, { headers: TAT_HEADERS });
    if (!res.ok) throw new Error(`TAT API error: ${res.status}`);
    return res.json();
}

async function fetchTATPlaceDetail(tatPlaceId) {
    if (!TAT_API_KEY || TAT_API_KEY === 'your_tat_api_key_here') {
        throw new Error('ไม่ได้ตั้งค่า TAT API Key ในระบบ (.env)');
    }
    const res = await fetch(`${TAT_API_BASE}/places/${tatPlaceId}`, { headers: TAT_HEADERS });
    if (!res.ok) throw new Error(`TAT API error: ${res.status}`);
    const payload = await res.json();
    return payload.data || payload.result || payload;
}

async function upsertTATPlace(place) {
    // รวบรวมรูปภาพจากทุก field ที่เป็นไปได้
    let allImageUrls = [
        ...(place.desktopImageUrls || []),
        ...(place.mobileImageUrls || []),
        ...(place.picture_urls || []),
        ...(place.web_picture_urls || []),
    ];

    if (place.sha?.detailPicture) {
        const shaImgs = Array.isArray(place.sha.detailPicture) ? place.sha.detailPicture : [place.sha.detailPicture];
        allImageUrls.push(...shaImgs);
    }

    if (place.multimedia && Array.isArray(place.multimedia)) {
        allImageUrls.push(...place.multimedia.map(m => m.url));
    }

    // ล้างค่าว่าง และค่าที่ไม่ใช่ string
    allImageUrls = allImageUrls.filter(url => typeof url === 'string' && url.trim().length > 0);

    const images = allImageUrls.map(url => ({ url, is_cover: false }));

    let mainImageUrl = place.thumbnailUrl || (images.length > 0 ? images[0].url : null);
    
    if (mainImageUrl) {
        images.unshift({ url: mainImageUrl, is_cover: true });
    }

    // Deduplicate images by url
    const uniqueImages = [];
    const seenUrls = new Set();
    for (const img of images) {
        if (!seenUrls.has(img.url)) {
            seenUrls.add(img.url);
            uniqueImages.push(img);
        }
    }

    const provName = place.location?.province?.name || place.province_name || place.provinceName || place.province || '';
    const distName = place.location?.district?.name || place.district_name || place.districtName || place.district || '';
    const subDistName = place.location?.subDistrict?.name || place.sub_district || place.subDistrictName || place.subDistrict || '';

    const locationParts = [subDistName, distName, provName].filter(Boolean);
    const locationString = locationParts.length > 0 ? locationParts.join(', ') : null;

    const { rows } = await query(
        `INSERT INTO destinations (
            name, province, description, category, tags,
            latitude, longitude, address,
            opening_time, closing_time, opening_hours,
            image_url, images, source, status,
            tat_place_id, tat_raw
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'tat','approved',$14,$15)
        ON CONFLICT (tat_place_id) DO UPDATE SET
            name          = EXCLUDED.name,
            province      = EXCLUDED.province,
            description   = CASE WHEN destinations.override_description IS NOT NULL
                            THEN destinations.description ELSE EXCLUDED.description END,
            category      = EXCLUDED.category,
            tags          = EXCLUDED.tags,
            latitude      = EXCLUDED.latitude,
            longitude     = EXCLUDED.longitude,
            address       = EXCLUDED.address,
            opening_time  = EXCLUDED.opening_time,
            closing_time  = EXCLUDED.closing_time,
            opening_hours = EXCLUDED.opening_hours,
            image_url     = EXCLUDED.image_url,
            images        = EXCLUDED.images,
            tat_raw       = EXCLUDED.tat_raw,
            updated_at    = NOW()
        RETURNING id`,
        [
            place.name,
            locationString,
            place.information?.detail      || null,
            mapCategory(place.category?.name),
            (place.tags || []).filter(Boolean),
            parseFloat(place.latitude)  || null,
            parseFloat(place.longitude) || null,
            place.location?.address     || null,
            place.openingHours?.[0]?.open  || place.openingHours?.[0]?.openTime  || '00:00',
            place.openingHours?.[0]?.close || place.openingHours?.[0]?.closeTime || '00:00',
            JSON.stringify(place.openingHours || []),
            mainImageUrl || null,
            JSON.stringify(uniqueImages),
            String(place.placeId || place.id),
            JSON.stringify(place),
        ]
    );

    const destinationId = rows[0].id;
    await query('DELETE FROM destination_images WHERE destination_id = $1', [destinationId]);
    if (uniqueImages.length > 0) {
        const values = [];
        const placeholders = uniqueImages.map((image, index) => {
            values.push(destinationId, image.url);
            return `($${index * 2 + 1}, $${index * 2 + 2})`;
        });
        await query(
            `INSERT INTO destination_images (destination_id, image_url)
             VALUES ${placeholders.join(', ')}`,
            values,
        );
    }
    return rows[0];
}

async function syncAllTATPlaces(options = {}) {
    const { province = '', keyword = '', placeCategory = '', maxPages = 50, hydrateDetails = false } = options;
    let page = 1, totalUpserted = 0, totalEmbedded = 0, totalFailed = 0;
    console.log(`[tat-sync] เริ่ม sync — province:"${province}" keyword:"${keyword}" placeCategory:"${placeCategory}"`);

    while (page <= maxPages) {
        let data;
        try { data = await fetchTATPage(page, 100, keyword, province, placeCategory); }
        catch (err) { console.error(`[tat-sync] page ${page} error:`, err.message); break; }

        const places = data.result || data.data || [];
        if (places.length === 0) break;
        console.log(`[tat-sync] page ${page} — ${places.length} places`);

        for (const place of places) {
            try {
                const tatPlaceId = place.placeId || place.id;
                const detailPlace = hydrateDetails && tatPlaceId
                    ? { ...place, ...(await fetchTATPlaceDetail(tatPlaceId)), placeId: tatPlaceId }
                    : place;
                const row = await upsertTATPlace(detailPlace);
                totalUpserted++;
                await embedDestination(row.id);
                totalEmbedded++;
                await new Promise(r => setTimeout(r, 120));
            } catch (err) {
                totalFailed++;
                console.error(`[tat-sync] ✗ place ${place.placeId}:`, err.message);
            }
        }
        if (places.length < 100) break;
        page++;
    }

    const summary = { totalUpserted, totalEmbedded, totalFailed, pages: page };
    console.log('[tat-sync] done:', summary);
    return summary;
}

async function syncOneTATPlace(tatPlaceId) {
    const place = await fetchTATPlaceDetail(tatPlaceId);
    const row = await upsertTATPlace(place);
    await embedDestination(row.id);
    return row;
}

// POST /api/admin/embed/bulk
const bulkEmbed = async (req, res) => {
    try {
        res.json({ message: 'bulk embed เริ่มทำงาน (background)' });
        // รัน background ไม่ block response
        bulkEmbedMissing().catch(err =>
            console.error('[adminEmbed] bulkEmbedMissing error:', err.message)
        );
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// POST /api/admin/embed/:id
const embedOne = async (req, res) => {
    try {
        const ok = await embedDestination(parseInt(req.params.id));
        if (!ok) return res.status(404).json({ message: 'ไม่พบ destination หรือยังไม่ approved' });
        res.json({ message: 'embed สำเร็จ' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// POST /api/admin/sync/tat
const syncTAT = async (req, res) => {
    try {
        const { province, keyword, placeCategory } = req.body;
        res.json({ message: 'TAT sync เริ่มทำงาน (background)' });
        syncAllTATPlaces({ province, keyword, placeCategory, hydrateDetails: true }).catch(err =>
            console.error('[adminEmbed] syncTAT error:', err.message)
        );
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// POST /api/admin/sync/tat/:tatPlaceId
const syncOneTAT = async (req, res) => {
    try {
        const row = await syncOneTATPlace(req.params.tatPlaceId);
        res.json({ message: 'sync และ embed สำเร็จ', id: row.id });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

module.exports = { bulkEmbed, embedOne, syncTAT, syncOneTAT };
