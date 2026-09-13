// server/services/restStopService.js
// จุดแวะพักระหว่างทางจาก OpenStreetMap ผ่าน Overpass API (ไม่ต้องใช้ key, ฟรี)
// ใช้ 2 จุด:
//  1. GET /api/mobile/rest-stops — ให้ Flutter ค้น POI รอบพิกัด (ร้านสะดวกซื้อ/ปั๊ม/คาเฟ่/โรงแรม)
//  2. aiHelper.generateTripPlan — ปักหมุดพักจริงกลางขาขับยาว ≥2 ชม. (car/bus) แล้วเดินโซ่เวลาใหม่
//
// หมายเหตุ license: ข้อมูล © OpenStreetMap contributors (ODbL) — ทุก response ต้องแนบ attribution

const { config } = require('../config/env');
const {
    haversineKm,
    computeLegMinutes,
    chainDayTimes,
    parseClockToMinutes,
    finiteCoord,
    DEFAULT_DAY_START_MINUTES,
} = require('../utils/planScheduler');

const REST_STOP_ATTRIBUTION =
    '© OpenStreetMap contributors (ODbL) · POI via Overpass API';

// Overpass filter ต่อประเภท — ใช้กับ nwr(...)(around:radius,lat,lon)
const REST_STOP_FILTERS = {
    convenience: '["shop"="convenience"]',
    fuel: '["amenity"="fuel"]',
    cafe: '["amenity"="cafe"]',
    restaurant: '["amenity"~"^(restaurant|fast_food)$"]',
    hotel: '["tourism"~"^(hotel|motel|guest_house|hostel)$"]',
    parking: '["amenity"="parking"]',
    toilets: '["amenity"="toilets"]',
    rest_area: '["highway"="rest_area"]',
};

// ชุด default ตาม use-case: แวะพักรายทาง vs ค้างคืน
const ROAD_REST_TYPES = ['convenience', 'fuel', 'cafe'];
const OVERNIGHT_TYPES = ['hotel'];

const TYPE_LABEL_TH = {
    convenience: 'ร้านสะดวกซื้อ',
    fuel: 'ปั๊มน้ำมัน',
    cafe: 'คาเฟ่',
    restaurant: 'ร้านอาหาร',
    hotel: 'ที่พัก',
    parking: 'ที่จอดรถ',
    toilets: 'ห้องน้ำ',
    rest_area: 'จุดพักรถ',
};

const REST_ELIGIBLE_MODES = new Set(['car', 'bus']);
const MAX_REST_PER_LEG = 2;
const MAX_REST_PER_DAY = 2;
const REST_STOP_DURATION_MINUTES = 20;

// cache ใน memory — Overpass public ช้า/rate-limit จึงจำผล 30 นาที (default)
const restCache = new Map(); // key -> { expiresAt, results }
const MAX_CACHE_ENTRIES = 200;

const getCache = (key) => {
    const entry = restCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        restCache.delete(key);
        return null;
    }
    return entry.results;
};

const setCache = (key, results) => {
    if (restCache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = restCache.keys().next().value;
        restCache.delete(oldestKey);
    }
    const ttl = Math.max(0, config.overpass?.cacheTtlMs ?? 1800000);
    restCache.set(key, { expiresAt: Date.now() + ttl, results });
};

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchWithTimeout = async (url, options = {}, timeoutMs) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
};

// เดารายละเอียดประเภทจาก tags ของ element (ใช้ตอน query รวมหลายประเภทพร้อมกัน)
const inferRestType = (tags = {}) => {
    if (tags.highway === 'rest_area') return 'rest_area';
    if (tags.amenity === 'fuel') return 'fuel';
    if (tags.amenity === 'cafe') return 'cafe';
    if (tags.amenity === 'restaurant' || tags.amenity === 'fast_food') return 'restaurant';
    if (tags.amenity === 'parking') return 'parking';
    if (tags.amenity === 'toilets') return 'toilets';
    if (tags.shop === 'convenience') return 'convenience';
    if (['hotel', 'motel', 'guest_house', 'hostel'].includes(tags.tourism)) return 'hotel';
    return 'place';
};

const resolvePoiName = (tags = {}, fallbackType = 'place') => {
    const named = String(tags['name:th'] || tags.name || '').trim();
    if (named) return named;
    const brand = String(tags.brand || tags.operator || '').trim();
    if (brand) return brand;
    return `${TYPE_LABEL_TH[fallbackType] || 'จุดแวะพัก'} (OSM)`;
};

// ค้น POI รอบพิกัด — คืน [] แทน throw เสมอ (caller ทำงานต่อได้โดยไม่มีจุดพัก)
async function searchRestStops(latitude, longitude, { radius = 5000, types = ROAD_REST_TYPES, limit = 10 } = {}) {
    const lat = finiteCoord(latitude);
    const lon = finiteCoord(longitude);
    if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180) return [];

    const wanted = [...new Set(
        (Array.isArray(types) ? types : String(types || '').split(','))
            .map((t) => String(t || '').trim().toLowerCase())
            .filter((t) => REST_STOP_FILTERS[t]),
    )];
    if (wanted.length === 0) return [];

    const cleanRadius = Math.min(20000, Math.max(500, Math.round(Number(radius) || 5000)));
    const cleanLimit = Math.min(20, Math.max(1, Math.round(Number(limit) || 10)));
    const cacheKey = `${lat.toFixed(3)}:${lon.toFixed(3)}:${cleanRadius}:${[...wanted].sort().join('+')}:${cleanLimit}`;
    const cached = getCache(cacheKey);
    if (cached) return cached.slice(0, cleanLimit);

    if (config.overpass && config.overpass.enabled === false) return [];

    const timeoutMs = Math.max(8000, config.overpass?.timeoutMs ?? 20000);
    const baseUrls = (config.overpass?.baseUrls?.length > 0
        ? config.overpass.baseUrls
        : ['https://overpass-api.de/api/interpreter']
    ).slice(0, 3); // ลองสูงสุด 3 instance กัน SSE รอนานเกิน — แต่รวมเวลาไม่ให้เกิน ~15 วิ
    const perAttemptMs = Math.min(timeoutMs, 10000);
    const buildQuery = (stepRadius) => {
        const clauses = wanted
            .map((t) => `nwr${REST_STOP_FILTERS[t]}(around:${stepRadius},${lat},${lon});`)
            .join('');
        return `[out:json][timeout:15];(${clauses});out center 40;`;
    };
    // เริ่มจากรัศมีแคบกัน Overpass 504 แล้วค่อยขยายถ้าไม่เจอ
    // (รัศมีกว้าง + หลาย filter = query หนัก โดยเฉพาะจุดกลางทุ่ง/ทางหลวงชนบท)
    const radiusSteps = cleanRadius <= 3000 ? [cleanRadius] : [3000, cleanRadius];

    for (const stepRadius of radiusSteps) {
    const ql = buildQuery(stepRadius);
    for (const baseUrl of baseUrls) {
        try {
            const response = await fetchWithTimeout(baseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'GoThai-RestStops/1.0',
                },
                body: `data=${encodeURIComponent(ql)}`,
            }, perAttemptMs);
            if (!response.ok) {
                console.warn(`[rest-stops] overpass ${response.status} from ${baseUrl}`);
                continue;
            }
            const payload = await response.json().catch(() => null);
            const elements = Array.isArray(payload?.elements) ? payload.elements : [];
            const pois = [];
            for (const el of elements) {
                const pLat = finiteCoord(el?.lat ?? el?.center?.lat);
                const pLon = finiteCoord(el?.lon ?? el?.center?.lon);
                if (pLat == null || pLon == null) continue;
                const tags = (el?.tags && typeof el.tags === 'object') ? el.tags : {};
                const type = inferRestType(tags);
                pois.push({
                    id: `osm:${el.type || 'node'}/${el.id}`,
                    osmType: el.type || 'node',
                    osmId: el.id,
                    name: resolvePoiName(tags, type),
                    brand: String(tags.brand || '').trim(),
                    type,
                    typeLabel: TYPE_LABEL_TH[type] || 'จุดแวะพัก',
                    latitude: pLat,
                    longitude: pLon,
                    openingHours: String(tags.opening_hours || '').trim(),
                    distanceKm: haversineKm(lat, lon, pLat, pLon) ?? null,
                });
            }
            pois.sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));
            const sliced = pois.slice(0, cleanLimit);
            // เจอแล้วก็คืนเลย — แต่ถ้าว่างและยังเหลือ step กว้างกว่าให้ลองต่อ
            if (sliced.length > 0 || stepRadius === radiusSteps[radiusSteps.length - 1]) {
                setCache(cacheKey, sliced);
                return sliced;
            }
        } catch (err) {
            console.warn(`[rest-stops] ${baseUrl} failed: ${err?.name === 'AbortError' ? 'timed out' : err.message}`);
            // instance แรก 429/504 บ่อยช่วงพีค — พักสั้น ๆ ก่อนลองตัวถัดไป กันโดน rate-limit ซ้ำ
            if (stepRadius === radiusSteps[0]) await sleepMs(800);
        }
    }
    }
    return [];
}

// สร้าง stop object สำหรับแทรกใน day.stops — chainDayTimes จะคำนวณเวลา/segments ให้ใหม่อีกที
const buildRestStop = (poi, mode) => ({
    destinationId: poi.id,
    place: poi.name,
    province: '',
    activity: `แวะพัก${poi.typeLabel || ''}ระหว่างทาง${poi.brand ? ` ${poi.brand}` : ''}`.trim(),
    latitude: poi.latitude,
    longitude: poi.longitude,
    imageUrl: '',
    arrivalTime: '09:00',
    durationMinutes: REST_STOP_DURATION_MINUTES,
    entryCost: 0,
    foodCost: 0,
    transportMode: mode,
    transportCost: 0,
    tip: `จุดแวะพักระหว่างทาง (${poi.typeLabel || 'OSM'}) — ข้อมูล ${REST_STOP_ATTRIBUTION}`,
    segments: [],
    stopType: 'rest',
    restType: poi.type,
    isRestStop: true,
});

// เติมจุดพักจริงกลางขาขับยาว ≥2 ชม. (car/bus) — mutate planData, best-effort ไม่ throw
// จำนวนที่แทรกต่อขา = floor(travel/120) (สูงสุด 2) รวมไม่เกิน 2 ต่อวัน กันแผนแน่นเกิน
async function enrichPlanWithRestStops(planData, { primaryMode = 'car' } = {}) {
    if (!planData || typeof planData !== 'object') return { added: 0 };
    if (config.overpass && config.overpass.enabled === false) return { added: 0 };
    const days = Array.isArray(planData.days) ? planData.days : [];
    if (days.length === 0) return { added: 0 };

    const usedOsmIds = new Set();
    let added = 0;

    for (const day of days) {
        const stops = Array.isArray(day?.stops) ? day.stops : [];
        if (stops.length < 2) continue;
        let dayAdded = 0;
        // เก็บงานแทรกเป็น (index รวม offset แล้ว) แล้ว splice จากหน้าไปหลัง
        const insertions = [];

        for (let i = 1; i < stops.length && dayAdded < MAX_REST_PER_DAY; i++) {
            const prev = stops[i - 1];
            const curr = stops[i];
            if (!prev || !curr || typeof prev !== 'object' || typeof curr !== 'object') continue;
            if (prev.isRestStop || curr.isRestStop) continue;
            if (String(prev.destinationId || '').startsWith('osm:')) continue;
            if (String(curr.destinationId || '').startsWith('osm:')) continue;

            const mode = String(curr.transportMode || primaryMode || 'car').toLowerCase();
            if (!REST_ELIGIBLE_MODES.has(mode)) continue;

            const km = haversineKm(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
            if (km == null) continue;
            const { travelMinutes } = computeLegMinutes(km, mode);
            if (travelMinutes < 120) continue;

            const needed = Math.min(Math.floor(travelMinutes / 120), MAX_REST_PER_LEG, MAX_REST_PER_DAY - dayAdded);
            if (needed <= 0) continue;

            const prevLat = finiteCoord(prev.latitude);
            const prevLon = finiteCoord(prev.longitude);
            const currLat = finiteCoord(curr.latitude);
            const currLon = finiteCoord(curr.longitude);
            if (prevLat == null || prevLon == null || currLat == null || currLon == null) continue;

            for (let k = 1; k <= needed && dayAdded < MAX_REST_PER_DAY; k++) {
                const frac = k / (needed + 1);
                const midLat = prevLat + (currLat - prevLat) * frac;
                const midLon = prevLon + (currLon - prevLon) * frac;
                let candidates = [];
                try {
                    candidates = await searchRestStops(midLat, midLon, {
                        radius: 5000,
                        types: ROAD_REST_TYPES,
                        limit: 3,
                    });
                } catch {
                    candidates = [];
                }
                const pick = candidates.find((c) => c && !usedOsmIds.has(c.id));
                if (!pick) continue;
                usedOsmIds.add(pick.id);
                insertions.push({ index: i + insertions.length, stop: buildRestStop(pick, mode) });
                dayAdded++;
            }
        }

        if (insertions.length > 0) {
            insertions.sort((a, b) => a.index - b.index);
            // index คำนวณรวม offset ของ insertion ก่อนหน้าแล้ว จึง splice จากหน้าไปหลัง
            for (const item of insertions) {
                stops.splice(item.index, 0, item.stop);
            }
            const anchor = parseClockToMinutes(stops[0]?.arrivalTime) ?? DEFAULT_DAY_START_MINUTES;
            chainDayTimes(day, anchor);
            added += insertions.length;
        }
    }

    if (added > 0) {
        planData.tips = Array.isArray(planData.tips) ? planData.tips : [];
        const credit = `แผนนี้มีจุดแวะพักระหว่างทาง ${added} จุดจาก ${REST_STOP_ATTRIBUTION}`;
        if (!planData.tips.includes(credit)) planData.tips.push(credit);
    }
    return { added };
}

module.exports = {
    REST_STOP_ATTRIBUTION,
    REST_STOP_FILTERS,
    ROAD_REST_TYPES,
    OVERNIGHT_TYPES,
    TYPE_LABEL_TH,
    REST_STOP_DURATION_MINUTES,
    searchRestStops,
    enrichPlanWithRestStops,
};
