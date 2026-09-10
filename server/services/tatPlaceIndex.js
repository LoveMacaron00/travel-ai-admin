// server/services/tatPlaceIndex.js
//
// TAT API ค้นด้วย keyword ไม่เจอเมื่อคำค้นเป็นคำไทยคำเดียวที่ใช้บ่อย
// (เช่น "วัด", "เกาะ", "หาด", "ตลาด" คืน total = 0 ทั้งที่มีข้อมูลอยู่จริง)
// จึงต้องมีดัชนีสถานที่ของเราเองไว้ค้นแบบ substring เมื่อ TAT คืนผลว่าง

const { tatHeadersFor } = require('../utils/tatLanguage');

const TAT_PAGE_SIZE = 500;
const MAX_INDEX_PAGES = 100;
const INDEX_FETCH_CONCURRENCY = 6;
const INDEX_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHED_INDEXES = 4;

// เก็บเฉพาะฟิลด์ที่หน้ารายการและการซิงก์ต้องใช้ เพื่อไม่ให้ดัชนีกินหน่วยความจำเกินจำเป็น
const trimPlace = (place) => ({
    placeId: place.placeId,
    name: place.name,
    status: place.status,
    introduction: place.introduction,
    category: place.category,
    sha: place.sha,
    latitude: place.latitude,
    longitude: place.longitude,
    location: place.location,
    thumbnailUrl: place.thumbnailUrl,
    tags: place.tags,
});

const searchableTexts = (place) => [
    place.name,
    place.introduction,
    place.location?.province?.name,
    place.location?.district?.name,
    place.category?.name,
];

const containsKeyword = (value, keyword) =>
    Boolean(value) && String(value).toLowerCase().includes(keyword);

// จำดัชนีตามชุดตัวกรอง (ภาษา/จังหวัด/หมวดหมู่) พร้อมกันคำขอซ้ำระหว่างกำลังโหลด
const indexCache = new Map();

const cacheKeyFor = ({ language, province, placeCategory }) =>
    [language, province || '', placeCategory || ''].join('|');

const evictExpired = () => {
    const now = Date.now();
    for (const [key, entry] of indexCache) {
        if (!entry.promise && entry.expiresAt <= now) indexCache.delete(key);
    }
    while (indexCache.size > MAX_CACHED_INDEXES) {
        const oldestKey = indexCache.keys().next().value;
        indexCache.delete(oldestKey);
    }
};

const fetchPlacePage = async ({ apiKey, apiBaseUrl, language, province, placeCategory }, page) => {
    const params = new URLSearchParams();
    params.set('limit', TAT_PAGE_SIZE);
    params.set('page', page);
    if (province) params.set('provinceName', province);
    if (placeCategory) params.set('place_category', placeCategory);

    const response = await fetch(`${apiBaseUrl}/places?${params}`, {
        headers: tatHeadersFor(apiKey, language),
    });
    if (!response.ok) throw new Error(`TAT API error: ${response.status}`);

    const payload = await response.json();
    return Array.isArray(payload.data) ? payload.data : [];
};

// ดึงทีละชุดแบบขนานเพื่อลดเวลารอครั้งแรก และตัด placeId ซ้ำที่หน้าถัดกันอาจส่งมาทับกัน
const fetchAllPlaces = async (options) => {
    const byPlaceId = new Map();

    for (let page = 1; page <= MAX_INDEX_PAGES; page += INDEX_FETCH_CONCURRENCY) {
        const pages = Array.from(
            { length: Math.min(INDEX_FETCH_CONCURRENCY, MAX_INDEX_PAGES - page + 1) },
            (_, offset) => page + offset,
        );
        const batches = await Promise.all(pages.map((pageNumber) => fetchPlacePage(options, pageNumber)));

        for (const items of batches) {
            for (const place of items) {
                if (place.placeId) byPlaceId.set(place.placeId, trimPlace(place));
            }
        }

        if (batches.some((items) => items.length === 0)) break;
    }

    return [...byPlaceId.values()];
};

const getPlaceIndex = async (options) => {
    evictExpired();

    const key = cacheKeyFor(options);
    const cached = indexCache.get(key);
    if (cached?.promise) return cached.promise;
    if (cached && cached.expiresAt > Date.now()) return cached.places;

    const promise = fetchAllPlaces(options)
        .then((places) => {
            indexCache.set(key, { places, expiresAt: Date.now() + INDEX_TTL_MS });
            return places;
        })
        .catch((err) => {
            indexCache.delete(key);
            throw err;
        });

    indexCache.set(key, { promise });
    return promise;
};

// ค้นสถานที่จากดัชนีแบบ substring: ให้ผลที่ชื่อตรงมาก่อน แล้วค่อยผลที่ตรงในรายละเอียดอื่น
const searchPlaceIndex = async ({ keyword, page, limit, ...indexOptions }) => {
    const places = await getPlaceIndex(indexOptions);
    const needle = String(keyword).trim().toLowerCase();

    const nameMatches = [];
    const otherMatches = [];
    for (const place of places) {
        if (containsKeyword(place.name, needle)) nameMatches.push(place);
        else if (searchableTexts(place).some((text) => containsKeyword(text, needle))) {
            otherMatches.push(place);
        }
    }

    const matches = [...nameMatches, ...otherMatches];
    const start = (page - 1) * limit;

    return {
        data: matches.slice(start, start + limit),
        pagination: { pageNumber: page, pageSize: limit, total: matches.length },
    };
};

// โหลดดัชนีภาษาไทยล่วงหน้าตอนเซิร์ฟเวอร์เริ่มทำงาน เพราะดึงครบทุกหน้าใช้เวลาราวหนึ่งนาที
const warmPlaceIndex = ({ apiKey, apiBaseUrl, language = 'th' }) => {
    if (!apiKey || apiKey === 'your_tat_api_key_here') return Promise.resolve();
    return getPlaceIndex({ apiKey, apiBaseUrl, language })
        .then((places) => console.log(`[tat-index] เตรียมดัชนีสถานที่ (${language}) แล้ว ${places.length} รายการ`))
        .catch((err) => console.error('[tat-index] เตรียมดัชนีสถานที่ไม่สำเร็จ:', err.message));
};

module.exports = { searchPlaceIndex, warmPlaceIndex };
