// server/controllers/adminEmbedController.js

const pool = require('../config/db');
const query = pool.query.bind(pool);
const { embedDestination, bulkEmbedMissing } = require('./helpers/embedHelper');
const { config } = require('../config/env');
const { tatHeadersFor } = require('./helpers/tatLanguage');
const { buildTATTranslation, getLocationParts } = require('./helpers/tatPlaceTranslation');

const TAT_API_KEY = config.tat.apiKey;
const TAT_API_BASE = config.tat.apiBaseUrl;

const CATEGORY_MAP = {
    'สถานที่ท่องเที่ยว': 'attraction',
    'ที่พัก': 'hotel',
    'ร้านอาหาร': 'restaurant',
    'ร้านค้า': 'shop',
    'บริการนักท่องเที่ยว': 'service',
    'กิจกรรม': 'activity',
};
const mapCategory = c => CATEGORY_MAP[c] ?? 'general';

async function fetchTATPage(page, limit = 100, keyword = '', province = '', placeCategory = '', languageCode = 'th') {
    if (!TAT_API_KEY || TAT_API_KEY === 'your_tat_api_key_here') {
        throw new Error('ไม่ได้ตั้งค่า TAT API Key ในระบบ (.env)');
    }
    const params = new URLSearchParams({
        numberOfResult: limit,
        page,
        ...(keyword && { keyword }),
        ...(province && { provinceName: province }),
        ...(placeCategory && { place_category: placeCategory }),
    });
    const res = await fetch(`${TAT_API_BASE}/places?${params}`, {
        headers: tatHeadersFor(TAT_API_KEY, languageCode),
    });
    if (!res.ok) throw new Error(`TAT API error: ${res.status}`);
    return res.json();
}

async function fetchTATPlaceDetail(tatPlaceId, languageCode = 'th') {
    if (!TAT_API_KEY || TAT_API_KEY === 'your_tat_api_key_here') {
        throw new Error('ไม่ได้ตั้งค่า TAT API Key ในระบบ (.env)');
    }
    const res = await fetch(`${TAT_API_BASE}/places/${tatPlaceId}`, {
        headers: tatHeadersFor(TAT_API_KEY, languageCode),
    });
    if (!res.ok) throw new Error(`TAT API error: ${res.status}`);
    const payload = await res.json();
    return payload.data || payload.result || payload;
}

async function upsertDestinationTranslation(destinationId, languageCode, place) {
    const translation = buildTATTranslation(place);
    if (!translation) return false;

    await query(
        `INSERT INTO destination_translations (
            destination_id, language_code, name, address, province,
            district, sub_district, postcode, description,
            tags, opening_hours, admission_fee, tat_raw
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (destination_id, language_code) DO UPDATE SET
            name = EXCLUDED.name,
            address = EXCLUDED.address,
            province = EXCLUDED.province,
            district = EXCLUDED.district,
            sub_district = EXCLUDED.sub_district,
            postcode = EXCLUDED.postcode,
            description = EXCLUDED.description,
            tags = EXCLUDED.tags,
            opening_hours = EXCLUDED.opening_hours,
            admission_fee = EXCLUDED.admission_fee,
            tat_raw = EXCLUDED.tat_raw,
            updated_at = NOW()`,
        [
            destinationId,
            languageCode,
            translation.name,
            translation.address,
            translation.province,
            translation.district,
            translation.subDistrict,
            translation.postcode,
            translation.description,
            translation.tags,
            JSON.stringify(translation.openingHours),
            JSON.stringify(translation.admissionFee),
            JSON.stringify(translation.tatRaw),
        ],
    );
    return true;
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

    const mainImageUrl = place.thumbnailUrl || (images.length > 0 ? images[0].url : null);

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

    const {
        address,
        provinceId,
        province,
        districtId,
        district,
        subDistrictId,
        subDistrict,
        postcode,
    } = getLocationParts(place);

    const { rows } = await query(
        `INSERT INTO destinations (
            name, address, province_id, province, district_id, district,
            sub_district_id, sub_district, postcode,
            description, category, tags, latitude, longitude,
            opening_time, closing_time, opening_hours,
            image_url, images, source, status,
            tat_place_id, tat_raw, admission_fee
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'tat','approved',$20,$21,$22)
        ON CONFLICT (tat_place_id) DO UPDATE SET
            name = EXCLUDED.name,
            address = EXCLUDED.address,
            province_id = EXCLUDED.province_id,
            province = EXCLUDED.province,
            district_id = EXCLUDED.district_id,
            district = EXCLUDED.district,
            sub_district_id = EXCLUDED.sub_district_id,
            sub_district = EXCLUDED.sub_district,
            postcode = EXCLUDED.postcode,
            description = EXCLUDED.description,
            category = EXCLUDED.category,
            tags = EXCLUDED.tags,
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude,
            opening_time = EXCLUDED.opening_time,
            closing_time = EXCLUDED.closing_time,
            opening_hours = EXCLUDED.opening_hours,
            image_url = EXCLUDED.image_url,
            images = EXCLUDED.images,
            tat_raw = EXCLUDED.tat_raw,
            admission_fee = EXCLUDED.admission_fee,
            updated_at = NOW()
        RETURNING id`,
        [
            place.name,
            address,
            provinceId,
            province,
            districtId,
            district,
            subDistrictId,
            subDistrict,
            postcode,
            place.information?.detail || null,
            mapCategory(place.category?.name),
            (place.tags || []).filter(Boolean),
            parseFloat(place.latitude) || null,
            parseFloat(place.longitude) || null,
            place.openingHours?.[0]?.open || place.openingHours?.[0]?.openTime || '00:00',
            place.openingHours?.[0]?.close || place.openingHours?.[0]?.closeTime || '00:00',
            JSON.stringify(place.openingHours || []),
            mainImageUrl || null,
            JSON.stringify(uniqueImages),
            String(place.placeId || place.id),
            JSON.stringify(place),
            JSON.stringify(place.information?.fee || place.fee || {}),
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
    let page = 1;
    let totalUpserted = 0;
    let totalEmbedded = 0;
    let totalFailed = 0;
    let totalTranslations = 0;
    let totalTranslationFailed = 0;
    console.log(`[tat-sync] เริ่ม sync — province:"${province}" keyword:"${keyword}" placeCategory:"${placeCategory}"`);

    while (page <= maxPages) {
        let data;
        try { data = await fetchTATPage(page, 100, keyword, province, placeCategory, 'th'); }
        catch (err) { console.error(`[tat-sync] page ${page} error:`, err.message); break; }

        const places = data.result || data.data || [];
        if (places.length === 0) break;
        console.log(`[tat-sync] page ${page} — ${places.length} places`);

        for (const place of places) {
            try {
                const tatPlaceId = place.placeId || place.id;
                const detailPlace = hydrateDetails && tatPlaceId
                    ? { ...place, ...(await fetchTATPlaceDetail(tatPlaceId, 'th')), placeId: tatPlaceId }
                    : place;
                const row = await upsertTATPlace(detailPlace);
                totalUpserted++;

                if (tatPlaceId) {
                    try {
                        const englishPlace = await fetchTATPlaceDetail(tatPlaceId, 'en');
                        const saved = await upsertDestinationTranslation(row.id, 'en', englishPlace);
                        if (saved) totalTranslations++;
                        else totalTranslationFailed++;
                    } catch (translationError) {
                        totalTranslationFailed++;
                        console.error(`[tat-sync] ✗ English translation ${tatPlaceId}:`, translationError.message);
                    }
                }

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

    const summary = {
        totalUpserted,
        totalEmbedded,
        totalFailed,
        totalTranslations,
        totalTranslationFailed,
        pages: page,
    };
    console.log('[tat-sync] done:', summary);
    return summary;
}

async function syncOneTATPlace(tatPlaceId) {
    const thaiPlace = await fetchTATPlaceDetail(tatPlaceId, 'th');
    const row = await upsertTATPlace(thaiPlace);
    const languages = ['th'];
    try {
        const englishPlace = await fetchTATPlaceDetail(tatPlaceId, 'en');
        if (await upsertDestinationTranslation(row.id, 'en', englishPlace)) {
            languages.push('en');
        }
    } catch (translationError) {
        console.error(`[tat-sync] ✗ English translation ${tatPlaceId}:`, translationError.message);
    }
    await embedDestination(row.id);
    return { ...row, languages };
}

async function syncMissingTATTranslations() {
    const { rows } = await query(
        `SELECT d.id, d.tat_place_id
         FROM destinations d
         LEFT JOIN destination_translations english
           ON english.destination_id = d.id
          AND english.language_code = 'en'
         WHERE d.source = 'tat'
           AND d.tat_place_id IS NOT NULL
           AND english.destination_id IS NULL
         ORDER BY d.id ASC`,
    );

    let synced = 0;
    let failed = 0;
    for (const row of rows) {
        try {
            const englishPlace = await fetchTATPlaceDetail(row.tat_place_id, 'en');
            if (await upsertDestinationTranslation(row.id, 'en', englishPlace)) {
                synced++;
            } else {
                failed++;
            }
            await new Promise((resolve) => setTimeout(resolve, 120));
        } catch (error) {
            failed++;
            console.error(
                `[tat-sync] ✗ English translation ${row.tat_place_id}:`,
                error.message,
            );
        }
    }

    return { total: rows.length, synced, failed };
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
        res.json({ message: 'sync และ embed สำเร็จ', id: row.id, languages: row.languages });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// POST /api/admin/sync/tat/translations
const syncTATTranslations = async (_req, res) => {
    try {
        const summary = await syncMissingTATTranslations();
        res.json({ message: 'sync English translations สำเร็จ', ...summary });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

module.exports = {
    bulkEmbed,
    embedOne,
    syncTAT,
    syncOneTAT,
    syncTATTranslations,
    fetchTATPlaceDetail,
    syncAllTATPlaces,
    syncOneTATPlace,
    syncMissingTATTranslations,
};
