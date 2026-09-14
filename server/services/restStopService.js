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
    estimateLegCostKm,
    chainDayTimes,
    parseClockToMinutes,
    finiteCoord,
    DEFAULT_DAY_START_MINUTES,
    DAY_BUDGET_MINUTES,
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

// ที่พักค้างคืนท้ายวัน (ยกเว้นวันสุดท้าย) — แนะนำจาก OSM เหมือนจุดพักรายทาง
// duration 60 นาทีคือเวลาเช็คอิน/พักผ่อน ไม่ใช่เวลานอนทั้งคืน จึงไม่ทำงบวันพัง
// และ chainDayTimes จะเดินโซ่เวลาใหม่ให้เหมือนจุดพักปกติ
const MAX_OVERNIGHT_PER_DAY = 1;
const OVERNIGHT_DURATION_MINUTES = 60;
const OVERNIGHT_RADIUS_METERS = 5000;
// DB destinations ไม่มีคอลัมน์ราคาที่พักแยก — ที่พักที่ sync จาก TAT เก็บราคาไว้ใน
// admission_fee (roomMinPrice/roomMaxPrice) จึงอ่านราคาจริงได้ ส่วนที่พักอื่นใช้ค่าประมาณนี้
const OVERNIGHT_ENTRY_COST_ESTIMATE = 1200;

// แผนที่พักแบบ "ฐานเดียว": ใช้ที่พักเดิมของทริปซ้ำทุกคืนถ้ายังสมเหตุสมผล
// เกณฑ์หลักคือระยะย้อนกลับจากที่พักเดิม → จุดสุดท้ายของวันนี้ + ที่พักเดิม → จุดแรกวันถัดไป
// รวมกันต้องไม่เกินครึ่งกรอบวัน (DAY_BUDGET_MINUTES / 2 ≈ 5 ชม.) ไม่เช่นนั้นเลือกที่พักใหม่ใกล้จุดสุดท้าย
// ที่พักเดิม = ที่พักคืนแรกของทริป (DB > OSM > placeholder ตามลำดับที่หาได้)
const REUSED_STAY_MAX_DETOUR_MINUTES = Math.round(DAY_BUDGET_MINUTES / 2);
// ค่าอาหารประมาณต่อจุดแวะพักรายทาง แยกตามประเภท POI (บาท/ครั้ง)
const REST_FOOD_COST_BY_TYPE = {
    convenience: 60,
    fuel: 0,
    cafe: 120,
    restaurant: 180,
    hotel: 0,
    parking: 20,
    toilets: 10,
    rest_area: 0,
    place: 50,
};

// ดึงตัวเลขราคาผู้ใหญ่/ราคาตั้งต้นจาก admission_fee object (best-effort) — ไม่มีให้ใช้ fallback
// กรณีที่พัก (หมวด hotel): sync พับ TAT minPrice/maxPrice ลง roomMinPrice/roomMaxPrice
// จึงอ่านราคาห้องก่อนค่าเข้าชม (ที่พักไม่มี information.fee) — ได้ราคาพักจริงแทนค่าประมาณ
const parseAdmissionPrice = (fee, fallback = OVERNIGHT_ENTRY_COST_ESTIMATE) => {
    if (fee == null) return fallback;
    if (typeof fee === 'number') return Number.isFinite(fee) && fee > 0 ? fee : fallback;
    if (typeof fee === 'string') {
        const parsed = Number(String(fee).replace(/,/g, ''));
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    }
    if (typeof fee !== 'object') return fallback;
    const candidates = [
        fee.roomMinPrice, fee.room_min_price, fee.roomMaxPrice, fee.room_max_price,
        fee.thaiAdult, fee.thai_adult, fee.adult, fee.price, fee.thb,
        fee.foreignerAdult, fee.thaiChild, fee.amount, fee.value,
    ];
    for (const candidate of candidates) {
        const text = String(candidate ?? '').replace(/,/g, '').match(/[\d.]+/);
        const parsed = text ? Number(text[0]) : NaN;
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    // เผื่อค่าซ่อนใน detail ข้อความ ("500 บาท")
    const detailMatch = String(fee.detail || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
    if (detailMatch) {
        const parsed = Number(detailMatch[1]);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return fallback;
};

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
// foodCost ประมาณตามประเภท POI (กาแฟ/อาหารมีค่าใช้จ่ายจริง) — entryCost จุดพักรายทางฟรี
const buildRestStop = (poi, mode) => {
    const restType = String(poi.type || 'place').toLowerCase();
    return {
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
        foodCost: REST_FOOD_COST_BY_TYPE[restType] ?? REST_FOOD_COST_BY_TYPE.place,
        transportMode: mode,
        transportCost: 0,
        tip: `จุดแวะพักระหว่างทาง (${poi.typeLabel || 'OSM'}) — ข้อมูล ${REST_STOP_ATTRIBUTION}`,
        segments: [],
        stopType: 'rest',
        restType: poi.type,
        isRestStop: true,
    };
};

// สร้าง stop ที่พักค้างคืนท้ายวัน — โครงเดียวกับจุดพักรายทาง แต่ duration 60 นาที
// (เวลาเช็คอิน/พัก ไม่ใช่เวลานอนทั้งคืน) และ tip บอกชัดว่าพักที่นี่ก่อนเที่ยวต่อวันถัดไป
// entryCost 1200 คือค่าที่พักประมาณ (DB ไม่มีคอลัมน์ราคา) — food/transport เติมตอน chain
const buildOvernightStop = (poi, mode) => ({
    destinationId: poi.id,
    place: poi.name,
    province: '',
    activity: `พักค้างคืน${poi.brand ? ` ${poi.brand}` : ''}`.trim() || 'พักค้างคืน',
    latitude: poi.latitude,
    longitude: poi.longitude,
    imageUrl: '',
    arrivalTime: '09:00',
    durationMinutes: OVERNIGHT_DURATION_MINUTES,
    entryCost: OVERNIGHT_ENTRY_COST_ESTIMATE,
    foodCost: 0,
    transportMode: mode,
    transportCost: 0,
    tip: `ที่พักค้างคืนท้ายวัน — พักที่นี่แล้วออกเดินทางต่อวันถัดไป (ข้อมูล ${REST_STOP_ATTRIBUTION})`,
    segments: [],
    stopType: 'overnight',
    restType: 'hotel',
    isRestStop: true,
});

// สร้าง stop ที่พักจากแถว destinations ใน DB (หมวด accommodation/hotel) — entryCost จาก admission_fee ถ้ามี
const buildOvernightStopFromDb = (row, mode) => {
    const lat = finiteCoord(row?.latitude);
    const lng = finiteCoord(row?.longitude);
    const name = String(row?.name || '').trim() || 'ที่พักค้างคืน';
    return {
        destinationId: String(row?.id ?? ''),
        place: name,
        province: String(row?.province || ''),
        activity: 'พักค้างคืน',
        latitude: lat,
        longitude: lng,
        imageUrl: String(row?.image_url || ''),
        arrivalTime: '09:00',
        durationMinutes: OVERNIGHT_DURATION_MINUTES,
        entryCost: parseAdmissionPrice(row?.admission_fee, OVERNIGHT_ENTRY_COST_ESTIMATE),
        foodCost: 0,
        transportMode: mode,
        transportCost: 0,
        tip: `ที่พักค้างคืนท้ายวัน — พักที่${name}แล้วออกเดินทางต่อวันถัดไป (จากฐานข้อมูลที่พัก)`,
        segments: [],
        stopType: 'overnight',
        restType: 'hotel',
        isRestStop: true,
    };
};

async function enrichPlanWithRestStops(planData, { primaryMode = 'car', startLat, startLng } = {}) {
    if (!planData || typeof planData !== 'object') return { added: 0 };
    if (config.overpass && config.overpass.enabled === false) return { added: 0 };
    const days = Array.isArray(planData.days) ? planData.days : [];
    if (days.length === 0) return { added: 0 };

    const usedOsmIds = new Set();
    let added = 0;
    let overnightAdded = 0;
    // ที่พัก "ฐานเดียว" ของทริป: คืนแรกหาได้ที่ไหน (DB > OSM > placeholder) คืนถัดไปใช้ที่เดิมซ้ำ
    // ถ้าไกลเกิน (ย้อนกลับรวม > ครึ่งกรอบวัน) จึงหาใหม่ใกล้จุดสุดท้ายของวันนั้น
    let baseStay = null;
    // ยอดค่าใช้จ่ายของจุดที่แทรกใหม่ — สะสมแล้วบวกเข้า totals ท้ายฟังก์ชันทีเดียว
    // (chainDayTimes เติม transportCost/segments ให้แล้ว แค่อ่านผลรวมจาก stop ที่แทรก ไม่แก้ stop ซ้ำ)
    let addedTransport = 0;
    let addedFood = 0;
    let addedEntry = 0;
    // อ่านค่า leg+อาหาร+ค่าเข้าของ stop ที่เพิ่งแทรก หลัง chainDayTimes เติมค่า leg แล้ว
    const collectStopCosts = (stop) => {
        if (!stop || typeof stop !== 'object') return;
        const legCost = Number(stop?.segments?.[0]?.estimatedCost);
        const transport = Number.isFinite(legCost) && legCost > 0
            ? legCost
            : (Number(stop?.transportCost) || 0);
        const food = Number(stop?.foodCost) || 0;
        const entry = Number(stop?.entryCost) || 0;
        if (Number.isFinite(transport) && transport > 0) addedTransport += transport;
        if (Number.isFinite(food) && food > 0) addedFood += food;
        if (Number.isFinite(entry) && entry > 0) addedEntry += entry;
    };

    const overnightEligible = (day, dayIndex) => {
        if (dayIndex >= days.length - 1) return false; // วันสุดท้ายไม่ต้องค้าง
        const stops = Array.isArray(day?.stops) ? day.stops : [];
        if (stops.length === 0) return false;
        // ข้ามเมื่อมีที่พักท้ายวันครบโควตาแล้ว (กัน enrich ซ้ำรอบ PUT หรือ AI ดึงที่พักมาเอง)
        // จุดพักรายทาง osm: กลางวันไม่ควรบล็อกที่พักค้างคืน — นับเฉพาะ stopType overnight
        const overnightCount = stops.filter((stop) =>
            stop && typeof stop === 'object' && stop.stopType === 'overnight').length;
        return overnightCount < MAX_OVERNIGHT_PER_DAY;
    };

    // เวลาเริ่มเดินโซ่ใหม่ของวันนั้น (departure): arrival จุดแรกที่เก็บไว้รวมขาแรกแล้ว
    // จึงหักขาแรกออกก่อน — ไม่งั้นแทรกจุดทีไรเวลาทั้งวันจะเลื่อนไปข้างหน้าทุกครั้ง
    // (logic เดียวกับ chainAllDaysPreservingOrder; ไม่มีขาแรกก็ใช้ arrival ตรง ๆ)
    const dayDeparture = (day) => {
        const stops = Array.isArray(day?.stops) ? day.stops : [];
        const arrival0 = parseClockToMinutes(stops[0]?.arrivalTime);
        const firstLeg = Number(stops[0]?.segments?.[0]?.estimatedMinutes);
        if (arrival0 != null && Number.isFinite(firstLeg) && firstLeg > 0) return arrival0 - firstLeg;
        return arrival0 ?? DEFAULT_DAY_START_MINUTES;
    };
    // หยิบจุดอ้างอิงท้ายวันสำหรับหาที่พัก: จุดที่ไม่ใช่ rest ท้ายสุด
    // (วันอาจลงท้ายด้วยจุดพักรายทางที่เพิ่งแทรก) — ถ้าทั้งวันมีแต่ rest ก็ใช้จุดสุดท้าย
    const findOvernightAnchor = (stops) => {
        for (let i = stops.length - 1; i >= 0; i--) {
            const stop = stops[i];
            if (!stop || typeof stop !== 'object') continue;
            if (stop.isRestStop === true) continue;
            if (String(stop.destinationId ?? '').startsWith('osm:')) continue;
            return stop;
        }
        return stops[stops.length - 1];
    };

    // นาทีเดินทางรวมของการ "ย้อนกลับ": ที่พักเดิม → จุดสุดท้ายวันนี้ + ที่พักเดิม → จุดแรกวันถัดไป
    // ใช้ประเมินว่าฐานเดียวของทริปยังสมเหตุสมผล หรือควรเปิดฐานใหม่ใกล้จุดเที่ยวแล้ว
    const estimateStayDetourMinutes = (stayLat, stayLng, lastLat, lastLng, nextFirst, mode) => {
        const backKm = haversineKm(stayLat, stayLng, lastLat, lastLng);
        if (backKm == null) return null;
        let total = computeLegMinutes(backKm, mode).travelMinutes;
        const nextLat = finiteCoord(nextFirst?.latitude);
        const nextLng = finiteCoord(nextFirst?.longitude);
        if (nextLat != null && nextLng != null) {
            const forthKm = haversineKm(stayLat, stayLng, nextLat, nextLng);
            if (forthKm == null) return null;
            total += computeLegMinutes(forthKm, mode).travelMinutes;
        }
        return total;
    };

    // โคลนที่พักฐานเดียวของทริปมาลงท้ายวันนี้ (ไม่ค้นใหม่) — dayIndex ใช้ตั้งชื่อ placeholder เท่านั้น
    const pushReusedStay = (day, dayIndex, stayTemplate, mode) => {
        const stops = Array.isArray(day?.stops) ? day.stops : [];
        const stay = {
            ...stayTemplate,
            destinationId: String(stayTemplate.destinationId ?? `db-pending-overnight-${dayIndex + 1}`),
            transportMode: mode,
            transportCost: 0,
            segments: [],
            stopType: 'overnight',
            restType: 'hotel',
            isRestStop: true,
        };
        usedOsmIds.add(`reused:${dayIndex}:${stay.destinationId}`);
        stops.push(stay);
        chainDayTimes(day, dayDeparture(day));
        collectStopCosts(stops[stops.length - 1]);
        added++;
        overnightAdded++;
    };

    const suggestOvernightNear = async (day, dayIndex) => {
        if (!overnightEligible(day, dayIndex)) return;
        const stops = Array.isArray(day?.stops) ? day.stops : [];
        if (stops.length === 0) return;
        // คืนที่พักค้างคืนทุกคืน 1..N-1: วันลงท้ายด้วย rest ก็ anchor ที่จุดจริงก่อนหน้า
        const anchorStop = findOvernightAnchor(stops);
        const lastLat = finiteCoord(anchorStop?.latitude);
        const lastLon = finiteCoord(anchorStop?.longitude);
        if (lastLat == null || lastLon == null) return;
        const mode = String(anchorStop?.transportMode || primaryMode || 'car').toLowerCase();
        // ค้างคืนใช้ยานพาหนะอะไรก็ได้ (นอนแล้วค่อยออก) — ไม่จำกัดแค่ car/bus
        // 1) คืนแรกของทริป (baseStay ยังว่าง): ค้นที่พักใหม่ใกล้จุดสุดท้ายของวัน
        //    คืนถัดไป: ใช้ที่พักเดิมซ้ำถ้าระยะย้อนกลับยังสมเหตุสมผล (≤ ครึ่งกรอบวัน)
        if (baseStay != null) {
            const stayLat = finiteCoord(baseStay.latitude);
            const stayLng = finiteCoord(baseStay.longitude);
            const nextFirst = days[dayIndex + 1]?.stops?.find(
                (stop) => stop && typeof stop === 'object' && stop.isRestStop !== true
                    && !String(stop.destinationId ?? '').startsWith('osm:'),
            ) || days[dayIndex + 1]?.stops?.[0];
            const detour = (stayLat != null && stayLng != null)
                ? estimateStayDetourMinutes(stayLat, stayLng, lastLat, lastLon, nextFirst, mode)
                : null;
            if (detour != null && detour <= REUSED_STAY_MAX_DETOUR_MINUTES) {
                pushReusedStay(day, dayIndex, baseStay, mode);
                return;
            }
            // ไกลเกิน — ล้างฐานเดิมแล้วตกลงไปค้นที่พักใหม่ใกล้จุดสุดท้ายด้านล่าง
            baseStay = null;
        }
        // 1) ลองฐานข้อมูลที่พัก (หมวด accommodation/hotel) ก่อน — ไม่พึ่งเน็ต/Overpass
        // หมายเหตุ: ข้อมูลจริงใน DB ตอนนี้ใช้ category='hotel' (2 แถว) ส่วน validator
        // รับ 'accommodation' ด้วย จึงต้องค้นทั้งสองหมวด ไม่งั้น DB-first จะไม่เคยเจอ
        try {
            // lazy require กัน circular: repository ไม่ได้ require กลับมาที่ไฟล์นี้
            const { findNearbyByCategory } = require('../repositories/placeSearchRepository');
            const rows = await findNearbyByCategory({
                latitude: lastLat,
                longitude: lastLon,
                limit: 3,
                categories: ['accommodation', 'hotel'],
            });
            const dbPick = (Array.isArray(rows) ? rows : []).find((row) => {
                if (!row || typeof row !== 'object') return false;
                if (finiteCoord(row.latitude) == null || finiteCoord(row.longitude) == null) return false;
                return !usedOsmIds.has(`db:${row.id}`);
            });
            if (dbPick) {
                usedOsmIds.add(`db:${dbPick.id}`);
                const dbStop = buildOvernightStopFromDb(dbPick, mode);
                stops.push(dbStop);
                chainDayTimes(day, dayDeparture(day));
                collectStopCosts(stops[stops.length - 1]);
                added++;
                overnightAdded++;
                // จำที่พักคืนแรกเป็น "ฐานเดียว" ของทริป — คืนถัดไปใช้ที่เดิมซ้ำถ้ายังไม่ไกลเกิน
                if (baseStay == null) baseStay = { ...dbStop };
                return;
            }
        } catch {
            // best-effort — DB ใช้ไม่ได้ก็ตกไปใช้ OSM ต่อ
        }
        // 2) fallback OSM โรงแรมรอบจุดสุดท้าย
        let candidates = [];
        try {
            candidates = await searchRestStops(lastLat, lastLon, {
                radius: OVERNIGHT_RADIUS_METERS,
                types: OVERNIGHT_TYPES,
                limit: 3,
            });
        } catch {
            candidates = [];
        }
        const pick = candidates.find((c) => c && !usedOsmIds.has(c.id));
        if (pick) {
            usedOsmIds.add(pick.id);
            const osmStop = buildOvernightStop(pick, mode);
            stops.push(osmStop);
            chainDayTimes(day, dayDeparture(day));
            collectStopCosts(stops[stops.length - 1]);
            added++;
            overnightAdded++;
            // จำที่พักคืนแรกเป็น "ฐานเดียว" ของทริป — คืนถัดไปใช้ที่เดิมซ้ำถ้ายังไม่ไกลเกิน
            if (baseStay == null) baseStay = { ...osmStop };
            return;
        }
        // 3) หาไม่เจอทั้งสองทาง — ปัก placeholder ให้คืนนั้นยังมีที่พักครบ N-1 คืน
        const fallbackStop = {
            destinationId: `db-pending-overnight-${dayIndex + 1}`,
            place: 'ที่พักค้างคืน (รอระบุ)',
            province: '',
            activity: 'พักค้างคืน',
            latitude: lastLat,
            longitude: lastLon,
            imageUrl: '',
            arrivalTime: '09:00',
            durationMinutes: OVERNIGHT_DURATION_MINUTES,
            entryCost: OVERNIGHT_ENTRY_COST_ESTIMATE,
            foodCost: 0,
            transportMode: mode,
            transportCost: 0,
            tip: 'ยังไม่พบที่พักใกล้จุดนี้ — ระบบจองคืนนี้ไว้ให้แล้ว กรุณาเลือกที่พักยืนยันอีกครั้ง',
            segments: [],
            stopType: 'overnight',
            restType: 'hotel',
            isRestStop: true,
        };
        usedOsmIds.add(fallbackStop.destinationId);
        stops.push(fallbackStop);
        chainDayTimes(day, dayDeparture(day));
        collectStopCosts(stops[stops.length - 1]);
        added++;
        overnightAdded++;
        // placeholder ก็เป็นฐานได้ — คืนถัดไปใช้ที่เดิมซ้ำจนกว่าระยะย้อนกลับจะไกลเกิน
        if (baseStay == null) baseStay = { ...fallbackStop };
    };

    // เติมจุดพักจริงกลางขาขับยาว ≥2 ชม. (car/bus) — mutate planData, best-effort ไม่ throw
    // จำนวนที่แทรกต่อขา = floor(travel/120) (สูงสุด 2) รวมไม่เกิน 2 ต่อวัน กันแผนแน่นเกิน
    const enrichRoadRestsForDay = async (day) => {
        const stops = Array.isArray(day?.stops) ? day.stops : [];
        if (stops.length < 2) return 0;
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
                const restStop = buildRestStop(pick, mode);
                insertions.push({ index: i + insertions.length, stop: restStop });
                dayAdded++;
            }
        }

        if (insertions.length > 0) {
            insertions.sort((a, b) => a.index - b.index);
            // index คำนวณรวม offset ของ insertion ก่อนหน้าแล้ว จึง splice จากหน้าไปหลัง
            for (const item of insertions) {
                stops.splice(item.index, 0, item.stop);
            }
            const anchor = dayDeparture(day);
            chainDayTimes(day, anchor);
            for (const item of insertions) collectStopCosts(item.stop);
        }
        return insertions.length;
    };

    for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
        const day = days[dayIndex];
        try {
            added += await enrichRoadRestsForDay(day);
        } catch {
            // best-effort — ขานี้หา POI ไม่ได้ก็ใช้แผนเดิมต่อได้
        }

        // ท้ายวัน (ยกเว้นวันสุดท้าย) แนะนำที่พักค้างคืน 1 แห่งใกล้จุดสุดท้ายของวัน
        // วันถัดไปเริ่มจากที่พักนี้ — applyDeterministicSchedule จัดลำดับด้วย anchor
        // จากจุดสุดท้ายของวันก่อน (รวมที่พักที่เพิ่งแทรก) จึงไม่ย้อนเส้นทาง
        if (overnightAdded < days.length - 1) {
            try {
                await suggestOvernightNear(day, dayIndex);
            } catch {
                // best-effort — ไม่มีที่พักก็ใช้แผนเดิมต่อได้
            }
        }
    }

    // ขากลับวันสุดท้าย → จุดเริ่มต้น: ไม่เพิ่ม stop แต่บันทึก returnLeg พร้อมค่าเดินทาง
    try {
        const homeLat = finiteCoord(startLat);
        const homeLng = finiteCoord(startLng);
        if (days.length > 0 && homeLat != null && homeLng != null) {
            const lastDay = days[days.length - 1];
            const lastStops = Array.isArray(lastDay?.stops) ? lastDay.stops : [];
            let lastStop = lastStops[lastStops.length - 1];
            for (let i = lastStops.length - 1; i >= 0; i--) {
                const stop = lastStops[i];
                if (!stop || typeof stop !== 'object') continue;
                if (stop.isRestStop === true) continue;
                if (String(stop.destinationId ?? '').startsWith('osm:')) continue;
                lastStop = stop;
                break;
            }
            const lastStopLat = finiteCoord(lastStop?.latitude);
            const lastStopLng = finiteCoord(lastStop?.longitude);
            if (lastStop && lastStopLat != null && lastStopLng != null) {
                const mode = String(lastStop.transportMode || primaryMode || 'car').toLowerCase();
                const km = haversineKm(lastStopLat, lastStopLng, homeLat, homeLng);
                if (km != null) {
                    const { travelMinutes } = computeLegMinutes(km, mode);
                    const cost = estimateLegCostKm(km, mode);
                    planData.returnLeg = {
                        from: String(lastStop.place || ''),
                        to: 'จุดเริ่มต้น',
                        latitude: homeLat,
                        longitude: homeLng,
                        distanceKm: Math.round(km * 10) / 10,
                        estimatedMinutes: travelMinutes,
                        estimatedCost: cost,
                        mode,
                    };
                    if (Number.isFinite(cost) && cost > 0) addedTransport += cost;
                    planData.tips = Array.isArray(planData.tips) ? planData.tips : [];
                    const legTip = `ขากลับจาก${String(lastStop.place || 'จุดสุดท้าย')}ถึงจุดเริ่มต้น ~${(Math.round(km * 10) / 10)} กม. ` +
                        `ใช้เวลา ~${travelMinutes} นาที ค่าเดินทางประมาณ ${cost} บาท`;
                    if (!planData.tips.includes(legTip)) planData.tips.push(legTip);
                }
            }
        }
    } catch {
        // best-effort — คำนวณขากลับไม่ได้ก็ข้าม ไม่ล้มทั้งแผน
    }

    // รวมค่าใช้จ่ายของจุดที่แทรก + ขากลับ เข้า totals (AI ไม่รู้ยอดพวกนี้ตอนตอบ)
    if (addedTransport > 0 || addedFood > 0 || addedEntry > 0) {
        const total = Number(planData.totalEstimatedCost);
        planData.totalEstimatedCost = (Number.isFinite(total) ? total : 0)
            + addedTransport + addedFood + addedEntry;
        if (!planData.budgetBreakdown || typeof planData.budgetBreakdown !== 'object') {
            planData.budgetBreakdown = { accommodation: 0, food: 0, transport: 0, activities: 0 };
        }
        const breakdown = planData.budgetBreakdown;
        const transport = Number(breakdown.transport);
        const food = Number(breakdown.food);
        const accommodation = Number(breakdown.accommodation);
        breakdown.transport = (Number.isFinite(transport) ? transport : 0) + addedTransport;
        breakdown.food = (Number.isFinite(food) ? food : 0) + addedFood;
        breakdown.accommodation = (Number.isFinite(accommodation) ? accommodation : 0) + addedEntry;
    }

    if (added > 0) {
        planData.tips = Array.isArray(planData.tips) ? planData.tips : [];
        const restCount = added - overnightAdded;
        if (restCount > 0) {
            const credit = `แผนนี้มีจุดแวะพักระหว่างทาง ${restCount} จุดจาก ${REST_STOP_ATTRIBUTION}`;
            if (!planData.tips.includes(credit)) planData.tips.push(credit);
        }
        if (overnightAdded > 0) {
            const uniqueStays = new Set();
            for (const day of days) {
                for (const stop of day?.stops || []) {
                    if (stop && typeof stop === 'object' && stop.stopType === 'overnight') {
                        uniqueStays.add(String(stop.destinationId ?? stop.place ?? ''));
                    }
                }
            }
            const baseName = baseStay ? String(baseStay.place || '').trim() : '';
            const credit = uniqueStays.size <= 1 && baseName
                ? `แผนนี้พักที่${baseName}ทุกคืน (${overnightAdded} คืน) — ใช้ที่พักเดิมตลอดทริปเพราะระยะย้อนกลับยังสมเหตุสมผล`
                : `แผนนี้มีที่พักค้างคืน ${overnightAdded} แห่งจาก ${REST_STOP_ATTRIBUTION}`;
            if (!planData.tips.includes(credit)) planData.tips.push(credit);
            const costNote = 'รวมค่าที่พักค้างคืนโดยประมาณไว้ในงบที่พักแล้ว (ที่พักละ ~1200 บาท หรือตามราคาในฐานข้อมูลถ้ามี)';
            if (!planData.tips.includes(costNote)) planData.tips.push(costNote);
        }
    }
    return { added, overnightAdded };
}

module.exports = {
    REST_STOP_ATTRIBUTION,
    REST_STOP_FILTERS,
    ROAD_REST_TYPES,
    OVERNIGHT_TYPES,
    TYPE_LABEL_TH,
    REST_STOP_DURATION_MINUTES,
    OVERNIGHT_DURATION_MINUTES,
    searchRestStops,
    enrichPlanWithRestStops,
};
