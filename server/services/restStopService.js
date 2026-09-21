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
const { fetchWithTimeout } = require('../utils/httpHelper');
const { createTtlCache } = require('../utils/ttlCache');

const REST_STOP_ATTRIBUTION =
    '© OpenStreetMap contributors (ODbL) · POI via Overpass API';

// Overpass filter ต่อประเภท — ใช้กับ nwr(...)(around:radius,lat,lon)
// สนามบินกรองเฉพาะที่มีรหัส IATA (ตัดสนามบินเล็ก/ลานบินย่อยที่ไม่มีเที่ยวบินพาณิชย์)
const REST_STOP_FILTERS = {
    convenience: '["shop"="convenience"]',
    fuel: '["amenity"="fuel"]',
    cafe: '["amenity"="cafe"]',
    restaurant: '["amenity"~"^(restaurant|fast_food)$"]',
    hotel: '["tourism"~"^(hotel|motel|guest_house|hostel)$"]',
    parking: '["amenity"="parking"]',
    toilets: '["amenity"="toilets"]',
    rest_area: '["highway"="rest_area"]',
    airport: '["aeroway"="aerodrome"]["iata"]',
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
    airport: 'สนามบิน',
};

// สนามบินอยู่ห่างกันมาก (ต่างจากปั๊ม/คาเฟ่) — ค้นได้ไกลสุด 200 กม. (ปั๊ม/คาเฟ่แค่ 20 กม.)
const AIRPORT_MAX_RADIUS_METERS = 200000;
const AIRPORT_SEARCH_RADIUS_METERS = 150000;
const AIRPORT_SEARCH_LIMIT = 3;

const REST_ELIGIBLE_MODES = new Set(['car', 'bus']);
const MAX_REST_PER_LEG = 2;
const MAX_REST_PER_DAY = 2;
const REST_STOP_DURATION_MINUTES = 20;

// วันขับรถรวม (car/bus) ตั้งแต่ 150 กม. ขึ้นไป เติมปั๊มน้ำมัน 1 จุดกลางขาที่ยาวสุด
// ให้แผนมีจุดแวะเติมน้ำมันจริง — ค้น OSM ในรัศมี 8 กม. รอบจุดกลางขา
const LONG_DRIVE_FUEL_KM = 150;
const FUEL_SEARCH_RADIUS_METERS = 8000;

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
    airport: 0,
    place: 50,
};

// วันนี้มีปั๊มน้ำมันแล้วหรือยัง (ปั๊ม OSM / AI / ที่เพิ่งแทรก) — เอาแค่ปั๊มวันละ 1 จุด
const isFuelStopLike = (stop) => stop && typeof stop === 'object'
    && (String(stop.restType || '').toLowerCase() === 'fuel'
        || /ปั๊มน้ำมัน|เติมน้ำมัน/i.test(`${stop.place || ''} ${stop.activity || ''}`));

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
// (logic เดิม ย้ายไปใช้ createTtlCache/fetchWithTimeout กลางใน utils)
const { get: getCache, set: setCache } = createTtlCache({
    maxEntries: 200,
    getTtlMs: () => Math.max(0, config.overpass?.cacheTtlMs ?? 1800000),
});

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// เดารายละเอียดประเภทจาก tags ของ element (ใช้ตอน query รวมหลายประเภทพร้อมกัน)
const inferRestType = (tags = {}) => {
    if (tags.aeroway === 'aerodrome') return 'airport';
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
    // สนามบินต่อรหัส IATA ท้ายชื่อเสมอ (เช่น "ท่าอากาศยานดอนเมือง (DMK)") —
    // การ์ดแผนโชว์ชื่อนี้ตรง ๆ ผู้ใช้เห็นได้ทันทีว่าบินขึ้น/ลงที่ไหน
    if (fallbackType === 'airport') {
        const iata = String(tags.iata || '').trim().toUpperCase();
        const base = named || String(tags.brand || tags.operator || '').trim() || 'สนามบิน';
        return iata ? `${base} (${iata})` : `${base} (OSM)`;
    }
    if (named) return named;
    const brand = String(tags.brand || tags.operator || '').trim();
    if (brand) return brand;
    return `${TYPE_LABEL_TH[fallbackType] || 'จุดแวะพัก'} (OSM)`;
};

// ฐานทัพอากาศล้วน (เช่น ฐานบินโคกกะเทียม KKM) มี iata แต่ไม่มีเที่ยวบินพาณิชย์ —
// ข้ามไป (สนามบินทหารที่ใช้ร่วมกับพลเรือนอย่างดอนเมืองมี aerodrome:type=military/public จึงรอด)
const isMilitaryOnlyAirfield = (tags = {}) => {
    const useType = String(tags['aerodrome:type'] || '').toLowerCase();
    if (useType.includes('public') || useType.includes('civil')) return false;
    if (tags.military != null && String(tags.military).trim() !== '') return true;
    const name = String(tags['name:th'] || tags.name || '');
    return /ฐานบิน|ฐานทัพอากาศ|air\s*force\s*base|\bair\s*base\b/i.test(name);
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

    const hasAirport = wanted.includes('airport');
    const maxRadius = hasAirport ? AIRPORT_MAX_RADIUS_METERS : 20000;
    const cleanRadius = Math.min(maxRadius, Math.max(500, Math.round(Number(radius) || 5000)));
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
    // สนามบินหายากในระยะใกล้ — ยิงรัศมีเต็มครั้งเดียว (ข้ามขั้น 3 กม. ที่ไม่มีวันเจอ)
    const radiusSteps = hasAirport
        ? [cleanRadius]
        : (cleanRadius <= 3000 ? [cleanRadius] : [3000, cleanRadius]);

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
                // ฐานทัพอากาศล้วนไม่มีเที่ยวบินพาณิชย์ — ข้าม (สนามบินร่วมทหาร/พลเรือนรอด)
                if (type === 'airport' && isMilitaryOnlyAirfield(tags)) continue;
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
                    iata: type === 'airport' ? String(tags.iata || '').trim().toUpperCase() : '',
                    icao: type === 'airport' ? String(tags.icao || '').trim().toUpperCase() : '',
                    distanceKm: haversineKm(lat, lon, pLat, pLon) ?? null,
                });
            }
            pois.sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));
            // สนามบินเดียวใน OSM มีได้หลาย element (node+way+relation) —
            // เรียงใกล้ก่อนแล้วตัดซ้ำด้วยรหัส IATA เก็บเฉพาะจุดที่ใกล้สุด
            const deduped = [];
            const seenIata = new Set();
            for (const poi of pois) {
                if (poi.iata) {
                    if (seenIata.has(poi.iata)) continue;
                    seenIata.add(poi.iata);
                }
                deduped.push(poi);
            }
            const sliced = deduped.slice(0, cleanLimit);
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

// รายชื่อสนามบินพาณิชย์หลักในไทย (IATA + พิกัดโดยประมาณ) — ตัวสำรองเมื่อ Overpass
// ค้นไม่เจอ/ล่ม ขาบินจะได้แทรกสนามบินเสมอ (IATA ถูกต้อง พิกัดใกล้เคียงพอสำหรับขาบิน)
const CURATED_AIRPORTS = [
    { iata: 'DMK', name: 'ท่าอากาศยานดอนเมือง', latitude: 13.91, longitude: 100.61 },
    { iata: 'BKK', name: 'ท่าอากาศยานสุวรรณภูมิ', latitude: 13.69, longitude: 100.75 },
    { iata: 'CNX', name: 'ท่าอากาศยานเชียงใหม่', latitude: 18.77, longitude: 100.01 },
    { iata: 'CEI', name: 'ท่าอากาศยานแม่ฟ้าหลวง เชียงราย', latitude: 19.95, longitude: 99.85 },
    { iata: 'HGN', name: 'ท่าอากาศยานแม่ฮ่องสอน', latitude: 19.30, longitude: 97.98 },
    { iata: 'LPT', name: 'ท่าอากาศยานลำปาง', latitude: 18.27, longitude: 99.50 },
    { iata: 'PRH', name: 'ท่าอากาศยานแพร่', latitude: 18.13, longitude: 100.16 },
    { iata: 'NNT', name: 'ท่าอากาศยานน่านนคร', latitude: 18.81, longitude: 100.78 },
    { iata: 'LOE', name: 'ท่าอากาศยานเลย', latitude: 17.44, longitude: 101.72 },
    { iata: 'PHS', name: 'ท่าอากาศยานพิษณุโลก', latitude: 16.78, longitude: 100.28 },
    { iata: 'MAQ', name: 'ท่าอากาศยานแม่สอด', latitude: 16.70, longitude: 98.55 },
    { iata: 'UTP', name: 'ท่าอากาศยานนานาชาติอู่ตะเภา', latitude: 12.68, longitude: 101.01 },
    { iata: 'HHQ', name: 'ท่าอากาศยานหัวหิน', latitude: 12.64, longitude: 99.95 },
    { iata: 'CJM', name: 'ท่าอากาศยานชุมพร', latitude: 10.72, longitude: 99.36 },
    { iata: 'URT', name: 'ท่าอากาศยานสุราษฎร์ธานี', latitude: 9.13, longitude: 99.14 },
    { iata: 'USM', name: 'ท่าอากาศยานสมุย', latitude: 9.55, longitude: 100.06 },
    { iata: 'UNN', name: 'ท่าอากาศยานระนอง', latitude: 9.87, longitude: 98.59 },
    { iata: 'HKT', name: 'ท่าอากาศยานภูเก็ต', latitude: 8.11, longitude: 98.31 },
    { iata: 'KBV', name: 'ท่าอากาศยานกระบี่', latitude: 8.10, longitude: 98.98 },
    { iata: 'TDX', name: 'ท่าอากาศยานตรัง', latitude: 7.51, longitude: 99.62 },
    { iata: 'NST', name: 'ท่าอากาศยานนครศรีธรรมราช', latitude: 8.54, longitude: 99.94 },
    { iata: 'HDY', name: 'ท่าอากาศยานหาดใหญ่', latitude: 6.93, longitude: 100.39 },
    { iata: 'NAW', name: 'ท่าอากาศยานนราธิวาส', latitude: 6.52, longitude: 101.74 },
    { iata: 'BTZ', name: 'ท่าอากาศยานเบตง', latitude: 5.78, longitude: 101.12 },
    { iata: 'UBP', name: 'ท่าอากาศยานอุบลราชธานี', latitude: 15.25, longitude: 104.87 },
    { iata: 'UDN', name: 'ท่าอากาศยานอุดรธานี', latitude: 17.39, longitude: 102.79 },
    { iata: 'KKC', name: 'ท่าอากาศยานขอนแก่น', latitude: 16.47, longitude: 102.78 },
    { iata: 'ROI', name: 'ท่าอากาศยานร้อยเอ็ด', latitude: 16.12, longitude: 103.77 },
    { iata: 'SNO', name: 'ท่าอากาศยานสกลนคร', latitude: 17.20, longitude: 104.12 },
    { iata: 'KOP', name: 'ท่าอากาศยานนครพนม', latitude: 17.38, longitude: 104.64 },
    { iata: 'BFV', name: 'ท่าอากาศยานบุรีรัมย์', latitude: 15.23, longitude: 103.25 },
];

// สนามบินสำรองที่ใกล้พิกัดสุดในรัศมี (คืน POI shape เดียวกับ OSM + source: 'curated')
const nearestCuratedAirports = (latitude, longitude, radiusMeters, limit) => {
    const out = [];
    for (const airport of CURATED_AIRPORTS) {
        const km = haversineKm(latitude, longitude, airport.latitude, airport.longitude);
        if (km == null || km * 1000 > radiusMeters) continue;
        out.push({
            id: `curated:${airport.iata}`,
            osmType: 'curated',
            osmId: airport.iata,
            name: `${airport.name} (${airport.iata})`,
            brand: '',
            type: 'airport',
            typeLabel: TYPE_LABEL_TH.airport,
            latitude: airport.latitude,
            longitude: airport.longitude,
            openingHours: '',
            iata: airport.iata,
            icao: '',
            distanceKm: km,
            source: 'curated',
        });
    }
    out.sort((a, b) => a.distanceKm - b.distanceKm);
    return out.slice(0, Math.max(limit, 1));
};

// ค้นสนามบินพาณิชย์ใกล้พิกัด — OSM ก่อน (สด/พิกัดตรง) ว่างหรือล่มค่อยใช้รายชื่อสำรอง
// (best-effort คืน [] เฉพาะเมื่อไม่มีสนามบินในรัศมีเลย — caller ใช้ขาบินตรงเดิมต่อได้)
// รัศมีกว้างกว่าจุดพักทั่วไปมาก (สนามบินอยู่ห่างกันเป็นร้อย กม.) สูงสุด 200 กม.
async function searchAirports(latitude, longitude, { radius = AIRPORT_SEARCH_RADIUS_METERS, limit = AIRPORT_SEARCH_LIMIT } = {}) {
    const cleanLimit = Math.max(limit, 1);
    const pois = await searchRestStops(latitude, longitude, { radius, types: ['airport'], limit: cleanLimit * 2 });
    const live = pois.filter((poi) => poi && poi.type === 'airport' && poi.iata).slice(0, cleanLimit);
    if (live.length > 0) return live;
    const lat = finiteCoord(latitude);
    const lon = finiteCoord(longitude);
    if (lat == null || lon == null) return [];
    const cleanRadius = Math.min(
        AIRPORT_MAX_RADIUS_METERS,
        Math.max(500, Math.round(Number(radius) || AIRPORT_SEARCH_RADIUS_METERS)),
    );
    return nearestCuratedAirports(lat, lon, cleanRadius, cleanLimit);
}

// สร้าง stop สนามบินสำหรับแทรกในขาบิน — chainDayTimes จะคำนวณเวลา/segments ให้ใหม่อีกที
// ขาบิน 1 ขาได้สนามบิน 2 จุด: ต้นทาง (นั่งรถไปขึ้นเครื่อง, duration 30 เผื่อเช็คอินเบื้องต้น)
// กับปลายทาง (ลงเครื่อง, duration 30 เผื่อรับกระเป๋า) — เวลารอขึ้นเครื่องหลัก (2 ชม.)
// อยู่ใน overhead ของขา flight อยู่แล้ว (ดู MODE_OVERHEAD_MINUTES)
// stopType 'transfer' (ไม่ใช่ 'rest') + isRestStop true เพื่อให้การ์ด/หมุดใช้ชุดเดียวกับจุดพัก
// แต่ข้อความ UI แยกด้วย restType 'airport' (ไอคอนเครื่องบิน + คำว่า "เปลี่ยนเครื่อง")
const AIRPORT_DEPARTURE_DURATION_MINUTES = 30;
const AIRPORT_ARRIVAL_DURATION_MINUTES = 30;

const buildAirportStop = (poi, mode, { isDeparture = true } = {}) => {
    // สนามบินสำรองพิกัดโดยประมาณ — บอกผู้ใช้ให้ตรวจสอบกับสายการบิน (OSM ใช้เครดิต ODbL)
    const sourceNote = poi.source === 'curated'
        ? 'ตำแหน่งสนามบินจากฐานข้อมูลสำรอง (พิกัดโดยประมาณ ควรตรวจสอบกับสายการบิน)'
        : `ข้อมูล ${REST_STOP_ATTRIBUTION}`;
    return {
        destinationId: poi.id,
        place: poi.name,
        province: '',
        activity: isDeparture
            ? `เดินทางไป${poi.name}เพื่อขึ้นเครื่อง`
            : `ลงเครื่องที่${poi.name}แล้วเดินทางต่อ`,
        latitude: poi.latitude,
        longitude: poi.longitude,
        imageUrl: '',
        arrivalTime: '09:00',
        durationMinutes: isDeparture ? AIRPORT_DEPARTURE_DURATION_MINUTES : AIRPORT_ARRIVAL_DURATION_MINUTES,
        entryCost: 0,
        foodCost: 0,
        transportMode: mode,
        transportCost: 0,
        tip: isDeparture
            ? `ขึ้นเครื่องที่${poi.name} — เผื่อเวลาเช็คอิน/โหลดกระเป๋าและตรวจสอบตารางบินกับสายการบินอีกครั้ง (${sourceNote})`
            : `ลงเครื่องที่${poi.name} — เผื่อเวลารับกระเป๋าแล้วเดินทางต่อ (${sourceNote})`,
        segments: [],
        stopType: 'transfer',
        restType: 'airport',
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

// ขาบินสมจริงด้วยสนามบินจริงจาก OSM (ไม่ต้องใช้ key, ฟรี)
// ขา flight ตรง prev → dest ที่ระยะ ≥250 กม. แทรกสนามบิน 2 จุด กลายเป็น:
// [..., prev, สนามบินต้นทาง (นั่งรถไป), สนามบินปลายทาง (บิน), dest (นั่งรถต่อ)]
// แล้วเดินโซ่เวลาใหม่ทั้งวัน — แผนที่วาดขารถตามถนนจริง (OSRM) + ขาบินเส้นตรงสนามบินถึงสนามบิน
// สนามบินต้น-ปลายห่างกัน <150 กม. หรือหาไม่เจอ → คงขาบินตรงเดิม (best-effort ไม่ล้มทั้งทริป)
// findAirports รับมาเพื่อทดสอบได้โดยไม่ต้องยิง Overpass (default = searchAirports)
const FLIGHT_MIN_DIRECT_KM = 250;
const FLIGHT_MIN_AIRPORT_KM = 150;

async function enrichPlanWithFlightTransfers(planData, {
    primaryGroundMode = 'car',
    startLat,
    startLng,
    findAirports = searchAirports,
} = {}) {
    if (!planData || typeof planData !== 'object') return { enriched: 0 };
    if (config.overpass && config.overpass.enabled === false) return { enriched: 0 };
    const days = Array.isArray(planData.days) ? planData.days : [];
    if (days.length === 0) return { enriched: 0 };
    const groundRaw = String(primaryGroundMode || 'car').toLowerCase();
    const groundMode = ['car', 'bus'].includes(groundRaw) ? groundRaw : 'car';
    // origin ของวันนั้น (helper กลาง — โหมดขาแรกคงที่ groundMode)
    const originFor = (dayIndex) => getDayOrigin(days, dayIndex, {
        startLat, startLng, modeFor: () => groundMode,
    });

    let enriched = 0;
    let transportDelta = 0;
    for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
        const day = days[dayIndex];
        const stops = Array.isArray(day?.stops) ? day.stops : [];
        if (stops.length === 0) continue;
        let i = 0;
        while (i < stops.length) {
            const stop = stops[i];
            // เฉพาะขาบินเข้าที่เที่ยวใน DB — ข้ามจุดพัก/ที่พัก/osm และขาที่ไม่ใช่ flight
            if (!stop || typeof stop !== 'object'
                || stop.isRestStop === true
                || String(stop.destinationId ?? '').startsWith('osm:')
                || String(stop.transportMode || '').toLowerCase() !== 'flight') {
                i++;
                continue;
            }
            let fromLat;
            let fromLng;
            if (i === 0) {
                const origin = originFor(dayIndex);
                if (!origin) { i++; continue; }
                fromLat = origin.lat;
                fromLng = origin.lng;
            } else {
                fromLat = finiteCoord(stops[i - 1]?.latitude);
                fromLng = finiteCoord(stops[i - 1]?.longitude);
                if (fromLat == null || fromLng == null) { i++; continue; }
            }
            const toLat = finiteCoord(stop.latitude);
            const toLng = finiteCoord(stop.longitude);
            if (toLat == null || toLng == null) { i++; continue; }
            // บินใกล้ ๆ ไม่คุ้มขึ้นเครื่อง — คงขาเดิมไว้
            const directKm = haversineKm(fromLat, fromLng, toLat, toLng);
            if (directKm == null || directKm < FLIGHT_MIN_DIRECT_KM) { i++; continue; }
            let depAirports = [];
            let arrAirports = [];
            try {
                [depAirports, arrAirports] = await Promise.all([
                    findAirports(fromLat, fromLng),
                    findAirports(toLat, toLng),
                ]);
            } catch {
                i++;
                continue;
            }
            const dep = Array.isArray(depAirports) ? depAirports[0] : null;
            const arr = Array.isArray(arrAirports) ? arrAirports[0] : null;
            const legDesc = `ขาบินวันที่ ${day?.day ?? '?'} ${Math.round(directKm)} กม. → ${stop.place || ''}`;
            if (!dep || !arr) {
                console.warn(`[flight] ${legDesc}: หาสนามบินไม่เจอ (ต้น=${dep?.iata || '-'} ปลาย=${arr?.iata || '-'} รัศมี 150 กม.) — คงขาบินตรงเดิม`);
                i++;
                continue;
            }
            // สนามบินเดียวกัน (เช่น เที่ยวรอบกรุงเทพ) หรือบินสั้นกว่าคุ้ม — ไม่ต้องแทรก
            if (dep.id === arr.id || (dep.iata && dep.iata === arr.iata)) {
                console.warn(`[flight] ${legDesc}: สนามบินต้นปลายเดียวกัน (${dep.iata || dep.id}) — คงขาบินตรงเดิม`);
                i++;
                continue;
            }
            const airKm = haversineKm(dep.latitude, dep.longitude, arr.latitude, arr.longitude);
            if (airKm == null || airKm < FLIGHT_MIN_AIRPORT_KM) {
                console.warn(`[flight] ${legDesc}: สนามบินห่างกันแค่ ~${airKm == null ? '-' : Math.round(airKm)} กม. — คงขาบินตรงเดิม`);
                i++;
                continue;
            }
            // แทรกสนามบิน 2 จุดหน้า dest; ขาสุดท้ายเป็นรถจึงเปลี่ยน dest เป็นภาคพื้น
            // (ล้างค่า leg เดิมของ dest ก่อน — ไม่งั้น chain คงราคา flight เดิมไว้)
            const oldDestTransport = Number(stop.transportCost) || 0;
            stop.transportCost = 0;
            stop.segments = [];
            stop.transportMode = groundMode;
            const depStop = buildAirportStop(dep, groundMode, { isDeparture: true });
            const arrStop = buildAirportStop(arr, 'flight', { isDeparture: false });
            const anchor = getDayDeparture(day);
            const origin = originFor(dayIndex);
            stops.splice(i, 0, depStop, arrStop);
            chainDayTimes(day, anchor, origin);
            const newSum = (Number(depStop.transportCost) || 0)
                + (Number(arrStop.transportCost) || 0)
                + (Number(stop.transportCost) || 0);
            transportDelta += newSum - oldDestTransport;
            const flightHours = Math.round((airKm / 550) * 10) / 10;
            const routeNote = `ขานี้บิน ${dep.iata || dep.name}→${arr.iata || arr.name} ` +
                `(~${Math.round(airKm)} กม. บิน ~${flightHours} ชม. ไม่รวมรอขึ้นเครื่อง) ` +
                `ควรตรวจสอบตารางบินกับสายการบินอีกครั้ง`;
            stop.tip = stop.tip ? `${stop.tip} ${routeNote}` : routeNote;
            enriched++;
            i += 3;
        }
    }
    // ปรับยอดรวมด้วยผลต่างค่าเดินทาง (ขาบินใหม่มักถูกลงเพราะเรทค่าเครื่องสมจริง)
    if (transportDelta !== 0) {
        const total = Number(planData.totalEstimatedCost);
        planData.totalEstimatedCost = Math.max(
            0, (Number.isFinite(total) ? total : 0) + transportDelta);
        if (!planData.budgetBreakdown || typeof planData.budgetBreakdown !== 'object') {
            planData.budgetBreakdown = { accommodation: 0, food: 0, transport: 0, activities: 0 };
        }
        const transport = Number(planData.budgetBreakdown.transport);
        planData.budgetBreakdown.transport = Math.max(
            0, (Number.isFinite(transport) ? transport : 0) + transportDelta);
    }
    if (enriched > 0) {
        planData.tips = Array.isArray(planData.tips) ? planData.tips : [];
        const credit = `ขาบินระยะไกล ${enriched} ขา ระบบแทรกสนามบินจริงจาก ${REST_STOP_ATTRIBUTION} ให้แล้ว ` +
            `(นั่งรถไปสนามบิน → บิน → นั่งรถต่อ)`;
        if (!planData.tips.includes(credit)) planData.tips.push(credit);
    }
    return { enriched };
}

// origin ของวันสำหรับคำนวณขาแรก (ใช้ร่วมกันทั้ง flight/rest enrichment):
// วันแรก = GPS/จุดปักของผู้ใช้, วันถัดไป = จุดสุดท้ายของวันก่อน
// modeFor(last, dayIndex) ตัดสินโหมดขาแรก — flight ใช้ groundMode คงที่,
// rest ใช้ primaryMode/โหมดจุดสุดท้ายของวันก่อน
const getDayOrigin = (days, dayIndex, { startLat, startLng, modeFor }) => {
    if (dayIndex <= 0) {
        const lat = finiteCoord(startLat);
        const lng = finiteCoord(startLng);
        if (lat == null || lng == null) return undefined;
        return { lat, lng, name: 'จุดเริ่มต้น', mode: modeFor(null, dayIndex) };
    }
    const prevStops = Array.isArray(days[dayIndex - 1]?.stops) ? days[dayIndex - 1].stops : [];
    const last = prevStops[prevStops.length - 1];
    const lat = finiteCoord(last?.latitude);
    const lng = finiteCoord(last?.longitude);
    if (lat == null || lng == null) return undefined;
    return {
        lat,
        lng,
        name: String(last?.place || '').trim(),
        mode: modeFor(last, dayIndex),
    };
};

// เวลาเริ่มเดินโซ่ใหม่ของวัน (departure): arrival จุดแรกหักขาแรกออก
// (logic เดียวกับ chainAllDaysPreservingOrder; ไม่มีขาแรกก็ใช้ arrival ตรง ๆ)
// สำคัญ: เรียกก่อน splice จุดแทรก (stops[0] ต้องยังเป็นจุดเดิม)
const getDayDeparture = (day) => {
    const stops = Array.isArray(day?.stops) ? day.stops : [];
    const arrival0 = parseClockToMinutes(stops[0]?.arrivalTime);
    const firstLeg = Number(stops[0]?.segments?.[0]?.estimatedMinutes);
    if (arrival0 != null && Number.isFinite(firstLeg) && firstLeg > 0) return arrival0 - firstLeg;
    return arrival0 ?? DEFAULT_DAY_START_MINUTES;
};

async function enrichPlanWithRestStops(planData, { primaryMode = 'car', startLat, startLng, skipOvernight = false } = {}) {
    if (!planData || typeof planData !== 'object') return { added: 0 };
    if (config.overpass && config.overpass.enabled === false) return { added: 0 };
    const days = Array.isArray(planData.days) ? planData.days : [];
    if (days.length === 0) return { added: 0 };
    // ทริป local (จุดเริ่มอยู่จังหวัดเดียวกับที่เที่ยว): นอนบ้านตัวเองได้
    // ข้ามที่พักค้างคืนทั้งหมด — client รุ่นเก่าที่ยังได้ที่พักมาจะตัดออกเองอีกชั้น
    const skipOvernightStay = skipOvernight === true;

    const usedOsmIds = new Set();
    let added = 0;
    let overnightAdded = 0;
    let fuelAdded = 0;
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

    // origin ของวันนั้น (helper กลาง — โหมดขาแรกตาม primaryMode/จุดสุดท้ายวันก่อน)
    // วันถัดไป anchor ที่จุดสุดท้ายของวันก่อน (enrich วันก่อนหน้าทำเสร็จแล้วเพราะวนตามลำดับ)
    const originFor = (dayIndex) => getDayOrigin(days, dayIndex, {
        startLat,
        startLng,
        modeFor: (last, idx) => (idx <= 0
            ? primaryMode
            : String(last?.transportMode || primaryMode || 'car')),
    });
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
        chainDayTimes(day, getDayDeparture(day));
        collectStopCosts(stops[stops.length - 1]);
        added++;
        overnightAdded++;
    };

    const suggestOvernightNear = async (day, dayIndex) => {
        if (skipOvernightStay) return;
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
                chainDayTimes(day, getDayDeparture(day));
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
            chainDayTimes(day, getDayDeparture(day));
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
        chainDayTimes(day, getDayDeparture(day));
        collectStopCosts(stops[stops.length - 1]);
        added++;
        overnightAdded++;
        // placeholder ก็เป็นฐานได้ — คืนถัดไปใช้ที่เดิมซ้ำจนกว่าระยะย้อนกลับจะไกลเกิน
        if (baseStay == null) baseStay = { ...fallbackStop };
    };

    // เติมปั๊มน้ำมันกลางขาขับยาว ≥2 ชม. (car/bus) — โควต้าตามขา ไม่นับรวมต่อวัน, mutate planData, best-effort ไม่ throw
    // ขาไหนมีปั๊มอยู่หัว/ท้ายขาแล้วข้ามขานั้นไป (กันปั๊มซ้อน) — เพิ่มที่ใหม่ไกลๆ ได้ปั๊มใหม่ไม่จำกัดครั้งรวม
    // จำนวนที่แทรกต่อขา = floor(travel/120) (สูงสุด 2) รวมต่อครั้งไม่เกิน 2 กันแผนแน่นเกิน
    // รวมขาแรก (จุดเริ่มทริป/จุดสุดท้ายวันก่อน → จุดแรกของวัน) ด้วย —
    // เคสขับข้ามจังหวัดวันแรกขานี้ยาวสุด แต่เดิมถูกข้ามเลยไม่มีจุดพักเลย
    const enrichRoadRestsForDay = async (day, dayIndex) => {
        const stops = Array.isArray(day?.stops) ? day.stops : [];
        if (stops.length < 1) return 0;
        let dayAdded = 0;
        // เก็บงานแทรกเป็น (index รวม offset แล้ว) แล้ว splice จากหน้าไปหลัง
        const insertions = [];
        const origin = originFor(dayIndex);

        // เอาแค่ปั๊มน้ำมัน — ไม่เจอปั๊มข้ามขานี้ไป ไม่เติมคาเฟ่/ร้านสะดวกซื้อแทน
        const pickRestNear = async (midLat, midLon) => {
            let candidates = [];
            try {
                candidates = await searchRestStops(midLat, midLon, {
                    radius: 5000,
                    types: ['fuel'],
                    limit: 3,
                });
            } catch {
                candidates = [];
            }
            return candidates.find((c) => c && !usedOsmIds.has(c.id)) || null;
        };

        // ขาแรก: origin → จุดแรกของวัน (เช่น GPS เชียงราย → ที่เที่ยวกรุงเทพ)
        if (origin && dayAdded < MAX_REST_PER_DAY) {
            const curr = stops[0];
            const isFreshStop = curr && typeof curr === 'object'
                && !curr.isRestStop
                && !String(curr.destinationId || '').startsWith('osm:')
                && !isFuelStopLike(curr);
            const mode = String(curr?.transportMode || origin.mode || primaryMode || 'car').toLowerCase();
            const currLat = finiteCoord(curr?.latitude);
            const currLon = finiteCoord(curr?.longitude);
            const km = (isFreshStop && currLat != null && currLon != null)
                ? haversineKm(origin.lat, origin.lng, currLat, currLon)
                : null;
            if (km != null && REST_ELIGIBLE_MODES.has(mode)) {
                const { travelMinutes } = computeLegMinutes(km, mode);
                if (travelMinutes >= 120) {
                    const needed = Math.min(Math.floor(travelMinutes / 120), MAX_REST_PER_LEG, MAX_REST_PER_DAY - dayAdded);
                    for (let k = 1; k <= needed && dayAdded < MAX_REST_PER_DAY; k++) {
                        const frac = k / (needed + 1);
                        const pick = await pickRestNear(
                            origin.lat + (currLat - origin.lat) * frac,
                            origin.lng + (currLon - origin.lng) * frac,
                        );
                        if (!pick) continue;
                        usedOsmIds.add(pick.id);
                        insertions.push({ index: insertions.length, stop: buildRestStop(pick, mode) });
                        dayAdded++;
                    }
                }
            }
        }

        for (let i = 1; i < stops.length && dayAdded < MAX_REST_PER_DAY; i++) {
            const prev = stops[i - 1];
            const curr = stops[i];
            if (!prev || !curr || typeof prev !== 'object' || typeof curr !== 'object') continue;
            // ขาไหนมีปั๊มอยู่หัว/ท้ายขาแล้วข้าม — กันปั๊มซ้อนขาเดิม
            // (ปลายเป็น osm: คือชนจุดพักด้วยกัน ข้ามเหมือนเดิม)
            if (String(curr.destinationId || '').startsWith('osm:')) continue;
            if (isFuelStopLike(prev) || isFuelStopLike(curr)) continue;

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
                const pick = await pickRestNear(
                    prevLat + (currLat - prevLat) * frac,
                    prevLon + (currLon - prevLon) * frac,
                );
                if (!pick) continue;
                usedOsmIds.add(pick.id);
                const restStop = buildRestStop(pick, mode);
                insertions.push({ index: i + insertions.length, stop: restStop });
                dayAdded++;
            }
        }

        if (insertions.length > 0) {
            // จับ departure ก่อน splice (stops[0] ต้องยังเป็นจุดเดิม)
            // แล้วเดินโซ่ใหม่พร้อม origin — ไม่งั้นขาแรกหายจากตารางเวลา
            const anchor = getDayDeparture(day);
            insertions.sort((a, b) => a.index - b.index);
            // index คำนวณรวม offset ของ insertion ก่อนหน้าแล้ว จึง splice จากหน้าไปหลัง
            for (const item of insertions) {
                stops.splice(item.index, 0, item.stop);
            }
            chainDayTimes(day, anchor, origin);
            for (const item of insertions) collectStopCosts(item.stop);
        }
        return insertions.length;
    };

    // วันขับรถรวมไกล (≥150 กม.) เติมปั๊มน้ำมัน 1 จุดกลางขาที่ยาวสุดที่ยังไม่มีปั๊ม
    // เอาแค่ปั๊มน้ำมันจริง — ไม่เจอปั๊มในรัศมี 8 กม. ข้ามไป ไม่เติมร้านสะดวกซื้อแทน
    // นับขาแรก (origin → จุดแรกของวัน) ด้วย — เคสขับข้ามจังหวัดขานี้ยาวสุด
    // เคารพโควต้าจุดพัก ≤2/วัน (วันที่มีจุดพักเต็มแล้วข้าม) ปั๊มไม่มีค่าเข้า/อาหาร มีแค่เวลาแวะ 20 นาที
    const suggestFuelStopForDay = async (day, dayIndex) => {
        const stops = Array.isArray(day?.stops) ? day.stops : [];
        if (stops.length < 1) return 0;
        const restCount = stops.filter((stop) =>
            stop && typeof stop === 'object'
            && (stop.isRestStop === true || String(stop.destinationId ?? '').startsWith('osm:'))).length;
        if (restCount >= MAX_REST_PER_DAY) return 0;
        const origin = originFor(dayIndex);
        let totalKm = 0;
        let longest = null;
        // ขาแรก: origin → จุดแรกของวัน (ข้ามถ้าจุดแรกเป็นปั๊มอยู่แล้ว)
        if (origin && stops.length >= 1) {
            const curr = stops[0];
            const isFreshStop = curr && typeof curr === 'object'
                && !curr.isRestStop
                && !String(curr.destinationId || '').startsWith('osm:')
                && !isFuelStopLike(curr);
            const mode = String(curr?.transportMode || origin.mode || primaryMode || 'car').toLowerCase();
            const currLat = finiteCoord(curr?.latitude);
            const currLon = finiteCoord(curr?.longitude);
            if (isFreshStop && (mode === 'car' || mode === 'bus') && currLat != null && currLon != null) {
                const km = haversineKm(origin.lat, origin.lng, currLat, currLon);
                if (km != null) {
                    totalKm += km;
                    longest = { index: 0, km, mode, fromLat: origin.lat, fromLng: origin.lng, toLat: currLat, toLng: currLon };
                }
            }
        }
        for (let i = 1; i < stops.length; i++) {
            const prev = stops[i - 1];
            const curr = stops[i];
            if (!prev || !curr || typeof prev !== 'object' || typeof curr !== 'object') continue;
            if (prev.isRestStop || curr.isRestStop) continue;
            const mode = String(curr.transportMode || primaryMode || 'car').toLowerCase();
            if (mode !== 'car' && mode !== 'bus') continue;
            const km = haversineKm(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
            if (km == null) continue;
            totalKm += km;
            // ขาที่มีปั๊มอยู่หัว/ท้ายแล้วไม่ชิงตำแหน่งขาที่ยาวสุด
            if (isFuelStopLike(prev) || isFuelStopLike(curr)) continue;
            if (!longest || km > longest.km) {
                longest = {
                    index: i, km, mode,
                    fromLat: finiteCoord(prev.latitude), fromLng: finiteCoord(prev.longitude),
                    toLat: finiteCoord(curr.latitude), toLng: finiteCoord(curr.longitude),
                };
            }
        }
        if (totalKm < LONG_DRIVE_FUEL_KM || !longest) return 0;
        if (longest.fromLat == null || longest.fromLng == null || longest.toLat == null || longest.toLng == null) return 0;
        const midLat = (longest.fromLat + longest.toLat) / 2;
        const midLon = (longest.fromLng + longest.toLng) / 2;
        let candidates = [];
        try {
            candidates = await searchRestStops(midLat, midLon, {
                radius: FUEL_SEARCH_RADIUS_METERS,
                types: ['fuel'],
                limit: 3,
            });
        } catch {
            candidates = [];
        }
        let pick = candidates.find((c) => c && !usedOsmIds.has(c.id));
        if (!pick) return 0;
        usedOsmIds.add(pick.id);
        const fuelStop = buildRestStop(pick, longest.mode);
        // จับ departure ก่อน splice แล้วเดินโซ่ใหม่พร้อม origin — ไม่งั้นขาแรกหายจากตารางเวลา
        const anchor = getDayDeparture(day);
        stops.splice(longest.index, 0, fuelStop);
        chainDayTimes(day, anchor, origin);
        collectStopCosts(stops[longest.index]);
        fuelAdded++;
        return 1;
    };

    for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
        const day = days[dayIndex];
        // วันขับรถรวมไกลเติมปั๊มก่อน 1 จุดกลางขาที่ยาวสุด (best-effort ไม่ล้มทั้งทริป)
        // ขาขับยาวค่อยเติมปั๊มเพิ่มในโควต้าที่เหลือ — เอาแค่ปั๊มน้ำมันทั้งคู่
        try {
            added += await suggestFuelStopForDay(day, dayIndex);
        } catch {
            // best-effort — หาปั๊มไม่เจอก็ใช้แผนเดิมต่อได้
        }
        try {
            added += await enrichRoadRestsForDay(day, dayIndex);
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
                    // car = รถตัวเอง estimateLegCostKm คิดน้ำมันให้แล้ว
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
        if (fuelAdded > 0) {
            const fuelTip = `แผนนี้มีจุดแวะเติมน้ำมัน ${fuelAdded} จุด — วันขับไกลแวะเติมระหว่างทางได้เลย`;
            if (!planData.tips.includes(fuelTip)) planData.tips.push(fuelTip);
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
    return { added, overnightAdded, fuelAdded };
}

module.exports = {
    REST_STOP_ATTRIBUTION,
    REST_STOP_FILTERS,
    ROAD_REST_TYPES,
    OVERNIGHT_TYPES,
    TYPE_LABEL_TH,
    REST_STOP_DURATION_MINUTES,
    LONG_DRIVE_FUEL_KM,
    FUEL_SEARCH_RADIUS_METERS,
    OVERNIGHT_DURATION_MINUTES,
    AIRPORT_SEARCH_RADIUS_METERS,
    AIRPORT_SEARCH_LIMIT,
    FLIGHT_MIN_DIRECT_KM,
    FLIGHT_MIN_AIRPORT_KM,
    AIRPORT_DEPARTURE_DURATION_MINUTES,
    AIRPORT_ARRIVAL_DURATION_MINUTES,
    searchRestStops,
    searchAirports,
    nearestCuratedAirports,
    CURATED_AIRPORTS,
    buildAirportStop,
    isMilitaryOnlyAirfield,
    enrichPlanWithFlightTransfers,
    enrichPlanWithRestStops,
};
