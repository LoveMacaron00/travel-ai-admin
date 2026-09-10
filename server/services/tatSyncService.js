// server/services/tatSyncService.js
// เครื่องยนต์ sync สถานที่ TAT + คำแปล — ย้ายออกจาก adminEmbedController
// Controller เหลือแค่ handlers บางๆ ที่เรียก service นี้
const { config } = require('../config/env');
const { tatHeadersFor } = require('../utils/tatLanguage');
const { buildTATTranslation, getLocationParts } = require('./tatPlaceTranslation');
const { bulkEmbedMissing } = require('./embedHelper');
const tatSyncRepository = require('../repositories/tatSyncRepository');

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
// แปลง category จาก TAT เป็นหมวดมาตรฐานของระบบ
const mapCategory = c => CATEGORY_MAP[c] ?? 'general';

// ดึงสถานที่หนึ่งหน้าจาก TAT API ตามตัวกรองที่กำหนด
async function fetchTATPage(page, limit = 100, keyword = '', province = '', placeCategory = '', languageCode = 'th') {
    if (!TAT_API_KEY || TAT_API_KEY === 'your_tat_api_key_here') {
        throw new Error('ไม่ได้ตั้งค่า TAT API Key ในระบบ (.env)');
    }
    const params = new URLSearchParams({
        limit,
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

// ดึงรายละเอียดสถานที่ TAT หนึ่งแห่งตามภาษา
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

// เพิ่มหรืออัปเดตคำแปลของสถานที่จาก payload TAT
async function upsertDestinationTranslation(destinationId, languageCode, place) {
    const translation = buildTATTranslation(place);
    if (!translation) return false;

    return tatSyncRepository.upsertTranslation(destinationId, languageCode, translation);
}

// เพิ่มหรืออัปเดตสถานที่ TAT และข้อมูลร่วมในตารางหลัก
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

    // ตัดรูปภาพที่มี URL ซ้ำกัน
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

    const row = await tatSyncRepository.upsertPlace({
        name: place.name,
        address,
        provinceId,
        province,
        districtId,
        district,
        subDistrictId,
        subDistrict,
        postcode,
        description: place.information?.detail || null,
        category: mapCategory(place.category?.name),
        tags: (place.tags || []).filter(Boolean),
        latitude: parseFloat(place.latitude) || null,
        longitude: parseFloat(place.longitude) || null,
        openingTime: place.openingHours?.[0]?.open || place.openingHours?.[0]?.openTime || '00:00',
        closingTime: place.openingHours?.[0]?.close || place.openingHours?.[0]?.closeTime || '00:00',
        openingHoursJson: JSON.stringify(place.openingHours || []),
        mainImageUrl: mainImageUrl || null,
        imagesJson: JSON.stringify(uniqueImages),
        tatPlaceId: String(place.placeId || place.id),
        tatRawJson: JSON.stringify(place),
        admissionFeeJson: JSON.stringify(place.information?.fee || place.fee || {}),
    });

    await tatSyncRepository.replacePlaceImages(
        row.id,
        uniqueImages.map((image) => image.url),
    );
    return row;
}

// sync สถานที่ TAT ทุกหน้าตามตัวเลือกและสรุปผลการทำงาน
async function syncAllTATPlaces(options = {}) {
    const {
        province = '',
        keyword = '',
        placeCategory = '',
        maxPages = Number.POSITIVE_INFINITY,
        hydrateDetails = false,
    } = options;
    let page = 1;
    let totalUpserted = 0;
    let totalFailed = 0;
    let totalTranslations = 0;
    let totalTranslationFailed = 0;
    const seenPageSignatures = new Set();

    console.log(`[tat-sync] เริ่ม sync — province:"${province}" keyword:"${keyword}" placeCategory:"${placeCategory}"`);

    while (page <= maxPages) {
        let data;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                data = await fetchTATPage(page, 100, keyword, province, placeCategory, 'th');
                break;
            } catch (err) {
                console.error(`[tat-sync] page ${page} attempt ${attempt} error:`, err.message);
                if (attempt < 3) {
                    await new Promise(resolve => setTimeout(resolve, attempt * 1000));
                }
            }
        }
        if (!data) break;

        const places = data.result || data.data || [];
        if (places.length === 0) break;
        const pageSignature = places
            .map(place => place.placeId || place.id)
            .filter(Boolean)
            .join('|');
        if (pageSignature && seenPageSignatures.has(pageSignature)) {
            console.error(`[tat-sync] page ${page} ซ้ำกับหน้าที่เคยได้รับ จึงหยุดเพื่อป้องกัน loop`);
            break;
        }
        if (pageSignature) seenPageSignatures.add(pageSignature);
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

                await new Promise(r => setTimeout(r, 120));
            } catch (err) {
                totalFailed++;
                console.error(`[tat-sync] ✗ place ${place.placeId}:`, err.message);
            }
        }
        const pagination = data.pagination || {};
        const total = Number(pagination.total);
        const actualPageSize = Number(pagination.pageSize) || places.length;
        const totalPages = Number.isFinite(total) && total >= 0 && actualPageSize > 0
            ? Math.ceil(total / actualPageSize)
            : null;
        if (totalPages !== null && page >= totalPages) break;
        page++;
    }

    const summary = {
        totalUpserted,
        totalFailed,
        totalTranslations,
        totalTranslationFailed,
        pages: page,
    };
    console.log('[tat-sync] done:', summary);
    return summary;
}

// sync รายละเอียดภาษาไทยและอังกฤษของสถานที่ TAT หนึ่งแห่ง
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
    return { ...row, languages };
}

// เติมคำแปลภาษาอังกฤษให้สถานที่ TAT ที่ยังไม่มีคำแปล
async function syncMissingTATTranslations() {
    const rows = await tatSyncRepository.findTatPlacesMissingEnglish();

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

let bulkEmbeddingJob = null;

// ใช้คิวเดียวต่อ process เพื่อป้องกันการกดซ้ำแล้วแย่ง Gemini quota กัน
function startBulkEmbeddingQueue() {
    if (bulkEmbeddingJob) return false;

    bulkEmbeddingJob = bulkEmbedMissing()
        .catch(err => {
            console.error('[adminEmbed] bulkEmbedMissing error:', err.message);
        })
        .finally(() => {
            bulkEmbeddingJob = null;
        });
    return true;
}

module.exports = {
    syncAllTATPlaces,
    syncOneTATPlace,
    syncMissingTATTranslations,
    startBulkEmbeddingQueue,
};
