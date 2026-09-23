// server/services/aiHelper.js

const tripRepository = require('../repositories/tripRepository');
const chatRepository = require('../repositories/chatRepository');
const { jsonrepair } = require('jsonrepair');
const {
    retrieveRelevantPlaces,
    retrieveNearbyPlaces,
    retrievePlacesByIds,
    formatPlacesContext,
} = require('./ragHelper');
const { ensureMustVisitStops, normalizePlanPlaces } = require('../utils/planPlaceNormalizer');
const {
    DAY_BUDGET_MINUTES,
    MAX_STOPS_PER_DAY,
    parseStartTimeInput,
    formatClock,
    finiteCoord,
    computeLegMinutes,
    orderStopsNearestNeighbor,
    chainDayTimes,
    estimateRecommendedDays,
    maxDistanceFromStart,
    validateDayFit,
    validateOpeningAndLateNight,
                    splitOverflowingDays,
                    repairDayOpeningOrder,
                    applyCarFuelCosts,
    normalizeThaiName,
} = require('../utils/planScheduler');
const { config } = require('../config/env');
const {
    freeWebSearch,
    formatWebSearchContext,
} = require('./webSearchHelper');
const {
    chatCompletion,
    chatCompletionStream,
} = require('./aiProvider');
// เดิมเรียก Gemini native ตรง ตอนนี้วิ่งผ่าน 9router (OpenAI-compatible) ผ่าน aiProvider
// (model/key/base URL อ่านจาก config.gemini ซึ่ง map ไป 9router แล้วใน env.js)
// ระบบไม่มีเครื่องบินแล้ว — เดินทางภาคพื้น/เรือเท่านั้น (รวมจักรยาน)
const SUPPORTED_TRANSPORT_MODES = new Set([
    'car',
    'walking',
    'bus',
    'train',
    'ferry',
    'bicycle',
]);
// alias ที่ client/AI อาจส่งมา → key หลัก
const TRANSPORT_MODE_ALIASES = {
    bike: 'bicycle',
    cycling: 'bicycle',
};
const LONG_DISTANCE_TRANSPORT_MODES = new Set(['train', 'ferry']);

// หน่วงเวลาแบบ async สำหรับการ retry request ไปยัง AI
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// คัดเฉพาะรูปแบบการเดินทางที่ระบบรองรับจากข้อมูลนำเข้าของผู้ใช้
const getAllowedTransportModes = (modes) => {
    const allowed = Array.isArray(modes)
        ? modes
            .map((mode) => String(mode).trim().toLowerCase())
            .map((mode) => TRANSPORT_MODE_ALIASES[mode] || mode)
            .filter((mode) => SUPPORTED_TRANSPORT_MODES.has(mode))
        : [];
    return allowed.length > 0 ? [...new Set(allowed)] : ['car'];
};

const getMustVisitRequests = (mustVisit) => {
    if (!Array.isArray(mustVisit)) return [];

    return mustVisit
        .map((place) => {
            if (place && typeof place === 'object') {
                return {
                    id: String(place.id ?? '').trim(),
                    name: String(place.name ?? '').trim(),
                    latitude: place.latitude,
                    longitude: place.longitude,
                };
            }
            return { id: '', name: String(place || '').trim() };
        })
        .filter((place) => place.id || place.name);
};

const mergePlaces = (...placeGroups) => {
    const merged = new Map();

    for (const place of placeGroups.flat()) {
        if (!place || typeof place !== 'object') continue;
        const id = String(place.id ?? '').trim();
        const key = id || String(place.name || '').trim().toLowerCase();
        if (!key || merged.has(key)) continue;
        merged.set(key, place);
    }

    return [...merged.values()];
};

const formatMustVisitList = (mustVisitPlaces, fallbackRequests) => {
    const source = mustVisitPlaces.length > 0 ? mustVisitPlaces : fallbackRequests;
    if (source.length === 0) return 'ไม่มี';

    return source
        .map((place) => {
            const id = place.id ? `รหัส ${place.id}` : 'ไม่มีรหัส';
            const name = place.name || 'ไม่ทราบชื่อ';
            const latitude = place.latitude ?? '-';
            const longitude = place.longitude ?? '-';
            return `${id}: ${name} (${latitude}, ${longitude})`;
        })
        .join(', ');
};

// ปรับ transport mode ของแผน AI ให้ตรงกับตัวเลือกที่อนุญาต
const normalizePlanTransportModes = (planData, allowedModes) => {
    // model อาจตอบ mode นอกตัวเลือกของผู้ใช้ จึงบังคับ schema เชิงธุรกิจอีกชั้น
    const canonMode = (value) => {
        const lower = String(value || '').trim().toLowerCase();
        return TRANSPORT_MODE_ALIASES[lower] || lower;
    };
    for (const day of planData.days || []) {
        for (const stop of day.stops || []) {
            const mode = canonMode(stop.transportMode);
            stop.transportMode = allowedModes.includes(mode) ? mode : allowedModes[0];

            if (Array.isArray(stop.segments)) {
                for (const segment of stop.segments) {
                    const segmentMode = canonMode(segment.mode);
                    segment.mode = allowedModes.includes(segmentMode)
                        ? segmentMode
                        : stop.transportMode;
                }
            }
        }
    }
};

const stopUsesFerry = (stop) => {
    if (String(stop?.transportMode || '').toLowerCase() === 'ferry') {
        return true;
    }
    return Array.isArray(stop?.segments) && stop.segments.some(
        (segment) => String(segment?.mode || '').toLowerCase() === 'ferry',
    );
};

const ISLAND_KEYWORDS = ['เกาะ', 'หมู่เกาะ', 'island', 'islands', 'koh', 'ko.'];
const ISLAND_PROVINCE_KEYWORDS = ['ภูเก็ต', 'phuket'];

// regex เดียวกับ normalizeThaiName กลาง — alias มาใช้แทนนิยามซ้ำ
const normalizeIslandName = normalizeThaiName;

const isIslandPlace = (place) => {
    if (!place || typeof place !== 'object') return false;
    const province = String(place.province || '').trim().toLowerCase();
    // ภูเก็ตทั้งจังหวัดถือเป็นเกาะ — เช็คตรง province เท่านั้น ไม่ใช่ substring ใน description
    if (province === 'ภูเก็ต' || province === 'phuket') return true;

    const name = String(place.name || '').toLowerCase();
    const category = String(place.category || '').toLowerCase();
    const tags = (Array.isArray(place.tags) ? place.tags.join(' ') : String(place.tags || '')).toLowerCase();
    const district = String(place.district || '').toLowerCase();
    const subDist = String(place.sub_district || '').toLowerCase();

    // district/sub_district มีคำว่า เกาะ → เกาะแน่นอน (เช่น เกาะพะงัน, เกาะช้าง)
    if (district.includes('เกาะ') || subDist.includes('เกาะ')) return true;
    if (district.includes('island') || subDist.includes('island')) return true;

    // ตรวจชื่อ/หมวด/แท็กด้วย regex มี word boundary สำหรับ koh
    const combined = `${name} ${category} ${tags} ${district} ${subDist}`;
    return /(เกาะ|หมู่เกาะ|island|\bkoh\b|\bko\.)/i.test(combined);
};

const getIslandStatusForStop = (stop, placeById, placeByName) => {
    const id = String(stop?.destinationId || '').trim();
    let place = id ? placeById.get(id) : null;
    if (!place) {
        const nameKey = normalizeIslandName(stop?.place);
        if (nameKey) place = placeByName.get(nameKey);
    }
    if (!place) return null;
    return isIslandPlace(place);
};

// นับการข้ามเกาะ↔ฝั่งทุกการเดินทาง ไม่จำกัดแค่ ferry
// ถ้ารู้ตำแหน่งเกาะ/ฝั่งจากฐานข้อมูลจะใช้ภูมิศาสตร์ตัดสิน ถ้าไม่รู้จะ fallback เป็น ferry เป็นสัญญาณข้ามทะเล
const findExcessIslandCrossings = (planData, mustVisitPlaces, allPlaces) => {
    const mustVisitIds = new Set(
        (mustVisitPlaces || [])
            .map((place) => String(place?.id || '').trim())
            .filter(Boolean),
    );
    const placeById = new Map();
    const placeByName = new Map();
    for (const place of allPlaces || []) {
        if (!place || typeof place !== 'object') continue;
        const id = String(place.id ?? '').trim();
        const nameKey = normalizeIslandName(place.name);
        if (id) placeById.set(id, place);
        if (nameKey) placeByName.set(nameKey, place);
    }

    const violations = [];

    for (const day of planData?.days || []) {
        const stops = day?.stops || [];
        if (stops.length < 2) continue;

        const crossings = [];
        let prevIsIsland = getIslandStatusForStop(stops[0], placeById, placeByName);

        for (let i = 1; i < stops.length; i++) {
            const currStop = stops[i];
            const currIsIsland = getIslandStatusForStop(currStop, placeById, placeByName);

            let isCrossing = false;
            if (prevIsIsland !== null && currIsIsland !== null) {
                // รู้ภูมิศาสตร์ทั้งสองจุด → นับเมื่อสลับ เกาะ↔ฝั่ง ไม่สนว่าใช้ car/bus/train/ferry/walking อะไร
                isCrossing = prevIsIsland !== currIsIsland;
            } else {
                // ข้อมูลภูมิศาสตร์ไม่พอ → ferry ถือว่าเป็นการข้ามทะเล (คงพฤติกรรมเดิมเป็น fallback)
                isCrossing = stopUsesFerry(currStop);
            }

            if (isCrossing) {
                crossings.push(currStop);
            }

            if (currIsIsland !== null) {
                prevIsIsland = currIsIsland;
            } else if (stopUsesFerry(currStop) && prevIsIsland !== null) {
                // ถ้าข้ามด้วยเรือแต่ไม่รู้ว่าปลายทางเป็นเกาะ ให้สลับฝั่งโดยประมาณเพื่อจับการไป-กลับ
                prevIsIsland = !prevIsIsland;
            }
        }

        const excessStops = crossings.slice(1).filter(
            (stop) => !mustVisitIds.has(String(stop?.destinationId || '').trim()),
        );
        if (excessStops.length > 0) {
            violations.push({ day: day?.day, stops: excessStops });
        }
    }

    return violations;
};

const formatFerryViolations = (violations) => violations
    .map((violation) =>
        `วันที่ ${violation.day || '?'}: ${violation.stops.map((stop) => stop.place).join(', ')}`,
    )
    .join('; ');

const formatIslandViolations = formatFerryViolations;

// เลือกเฉพาะสถานที่ที่ชื่อปรากฏในคำตอบของ AI จริง เรียงตามลำดับที่ถูกพูดถึง
// จับคู่แบบยืดหยุ่น: ชื่อเต็ม ชื่อย่อ หรือคำสำคัญตรงกันเกินส่วนใหญ่
// ถ้าไม่มีสถานที่ไหนถูกพูดถึงเลยจะไม่ส่ง card กลับ (ไม่ fallback เป็นผล RAG)
const pickPlacesMentionedInAnswer = (answer, places) => {
    const normalize = normalizeThaiName;
    const answerText = normalize(answer);
    if (!answerText) return [];

    const candidates = [];
    for (const place of places) {
        const name = normalize(place?.name);
        if (name.length < 4) continue;
        const index = answerText.indexOf(name);
        if (index >= 0) {
            // exact/full-name hit — ให้คะแนนความยาวชื่อเพื่อ prefer ชื่อเต็ม
            candidates.push({ place, name, index, score: name.length * 10 });
            continue;
        }
        // ชื่อย่อ: คำในชื่อสถานที่ปรากฏในคำตอบครบเกิน 60% (เช่น "อรุณ" ของ "วัดอรุณราชวราราม")
        const tokens = String(place?.name || '')
            .split(/[\s\u0E4F\-–,()]+/u)
            .map((token) => token.trim())
            .filter((token) => token.length >= 3);
        if (!tokens.length) continue;
        const hitTokens = tokens.filter((token) =>
            answerText.includes(normalize(token)),
        );
        const ratio = hitTokens.length / tokens.length;
        if (ratio >= 0.6) {
            candidates.push({
                place,
                name,
                index: answerText.indexOf(normalize(hitTokens[0])),
                score: ratio * 100,
            });
        }
    }

    // ตัด variant ที่ซ้อนกัน: ถ้า "วัดรองขนุน" ตรงเต็มแล้ว ให้ตัด "วัดรองขนุนศิลปิน"
    // ที่ชื่อมีชื่อที่ตรงกว่าซ้อนอยู่และโผล่ตำแหน่งเดียวกันออก
    const selected = [];
    for (const candidate of candidates) {
        const shadowed = candidates.some((other) =>
            other !== candidate
            && other.score > candidate.score
            && other.index <= candidate.index
            && other.index + other.name.length >= candidate.index + candidate.name.length
        );
        if (!shadowed) selected.push(candidate);
    }

    selected.sort((a, b) => a.index - b.index || b.score - a.score);
    return selected.map((item) => item.place);
};

// จัดกลุ่มใหม่แบบคำนวณใหม่แทนการทิ้ง error — รวมเกาะไว้ด้วยกัน ฝั่งไว้ด้วยกันให้เหลือข้ามไม่เกิน 1 ครั้ง/วัน
const regroupIslandsToMinimizeCrossings = (planData, allPlaces) => {
    const placeById = new Map();
    const placeByName = new Map();
    for (const place of allPlaces || []) {
        if (!place || typeof place !== 'object') continue;
        const id = String(place.id ?? '').trim();
        const nameKey = normalizeIslandName(place.name);
        if (id) placeById.set(id, place);
        if (nameKey) placeByName.set(nameKey, place);
    }
    let fixedAny = false;
    for (const day of planData?.days || []) {
        const stops = day?.stops || [];
        if (stops.length < 3) continue;
        const flags = stops.map((s) => getIslandStatusForStop(s, placeById, placeByName));
        const hasIsland = flags.some((v) => v === true);
        const hasMainland = flags.some((v) => v === false);
        if (!hasIsland || !hasMainland) continue;
        // นับข้ามก่อนจัดกลุ่ม
        let crossings = 0;
        for (let i = 1; i < flags.length; i++) {
            const a = flags[i - 1];
            const b = flags[i];
            if (a !== null && b !== null && a !== b) crossings++;
            else if (a === null || b === null) {
                // fallback ferry เมื่อไม่รู้ภูมิศาสตร์
                if (stopUsesFerry(stops[i])) crossings++;
            }
        }
        if (crossings <= 1) continue;

        const mainland = [];
        const island = [];
        const unknown = [];
        for (let i = 0; i < stops.length; i++) {
            const f = flags[i];
            if (f === true) island.push(stops[i]);
            else if (f === false) mainland.push(stops[i]);
            else unknown.push(stops[i]);
        }
        // คงลำดับเดิมภายในแต่ละกลุ่ม, เอาฝั่งก่อนเกาะ (เริ่มจากฝั่งส่วนใหญ่) เพื่อให้ข้ามแค่ครั้งเดียว
        const reordered = [...mainland, ...unknown, ...island];
        // ถ้าเรียงแล้วข้ามยังคงเดิม (เช่น unknown เยอะ) ให้ลองสลับกลุ่ม
        day.stops = reordered;
        fixedAny = true;
    }
    return fixedAny;
};

// จัดลำดับจุดแวะในแต่ละวันจากจุดเริ่มต้นจริง (greedy nearest-neighbor)
// แล้วเดินโซ่เวลา arrivalTime/segments จากระยะทางจริง — เขียนทับเวลาที่ AI เดามาทั้งหมด
// วันแรก anchor ที่ GPS ของผู้ใช้ วันถัดไป anchor ที่จุดสุดท้ายของวันก่อนหน้า
// startMinutes คือเวลาออกเดินทาง (departure) — ส่ง origin ทุกวันให้ chainDayTimes คิดขาแรกจริง
// แต่เวลาเริ่มนับใหม่ทุกวันตามเวลาเริ่มเดินทาง (เช่น ออก 08:30 ทุกวัน)
const applyDeterministicSchedule = (planData, { startLat, startLng, startMinutes, startName, primaryMode }) => {
    let anchorLat = finiteCoord(startLat);
    let anchorLng = finiteCoord(startLng);
    let anchorName = String(startName || '').trim() || 'จุดเริ่มต้น';
    let anchorMode = String(primaryMode || 'car').toLowerCase();
    for (const day of planData?.days || []) {
        const stops = Array.isArray(day?.stops) ? day.stops : [];
        if (stops.length === 0) continue;
        if (anchorLat != null && anchorLng != null) {
            day.stops = orderStopsNearestNeighbor(stops, anchorLat, anchorLng);
        }
        const hasAnchor = anchorLat != null && anchorLng != null;
        chainDayTimes(
            day,
            startMinutes,
            hasAnchor ? { lat: anchorLat, lng: anchorLng, name: anchorName, mode: anchorMode } : undefined,
        );
        const last = day.stops[day.stops.length - 1];
        const lastLat = finiteCoord(last?.latitude);
        const lastLng = finiteCoord(last?.longitude);
        if (lastLat != null && lastLng != null) {
            anchorLat = lastLat;
            anchorLng = lastLng;
            // วันถัดไป anchor ที่จุดสุดท้ายของวันนี้ — ใช้ชื่อจุดเป็นต้นทางขาแรก
            anchorName = String(last?.place || '').trim() || anchorName;
            anchorMode = String(last?.transportMode || anchorMode || 'car').toLowerCase();
        }
    }
    return planData;
};

const PLAN_RESPONSE_SCHEMA = {
    type: 'object',
    required: ['summary', 'totalEstimatedCost', 'budgetBreakdown', 'days', 'tips'],
    properties: {
        summary: { type: 'string' },
        totalEstimatedCost: { type: 'number' },
        budgetBreakdown: {
            type: 'object',
            required: ['food', 'transport', 'activities'],
            properties: {
                food: { type: 'number' },
                transport: { type: 'number' },
                activities: { type: 'number' },
            },
        },
        days: {
            type: 'array',
            items: {
                type: 'object',
                required: ['day', 'theme', 'stops'],
                properties: {
                    day: { type: 'integer' },
                    theme: { type: 'string' },
                    stops: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['place', 'activity', 'latitude', 'longitude', 'arrivalTime', 'durationMinutes', 'entryCost', 'foodCost', 'transportMode', 'transportCost', 'segments'],
                            properties: {
                                destinationId: { type: 'string' },
                                place: { type: 'string' },
                                province: { type: 'string' },
                                activity: { type: 'string' },
                                latitude: { type: 'number' },
                                longitude: { type: 'number' },
                                imageUrl: { type: 'string' },
                                arrivalTime: { type: 'string' },
                                durationMinutes: { type: 'integer' },
                                entryCost: { type: 'number' },
                                foodCost: { type: 'number' },
                                transportMode: { type: 'string' },
                                transportCost: { type: 'number' },
                                tip: { type: 'string' },
                                segments: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        required: ['mode', 'from', 'to', 'estimatedMinutes', 'estimatedCost'],
                                        properties: {
                                            mode: { type: 'string' },
                                            from: { type: 'string' },
                                            to: { type: 'string' },
                                            estimatedMinutes: { type: 'integer' },
                                            estimatedCost: { type: 'number' },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        mustEat: { type: 'array', items: { type: 'string' } },
        tips: { type: 'array', items: { type: 'string' } },
        warnings: { type: 'array', items: { type: 'string' } },
    },
};

// คืน async generator ที่ yield text delta เพื่อส่งต่อเป็น SSE โดยไม่รอคำตอบทั้งหมด
// ค้นเว็บด้วย freeWebSearch (Tavily หลัก) แล้วฝาก webContext มากับ systemPrompt แทน
// วิ่งผ่าน 9router (OpenAI-compatible streaming) — logic เดิมของ Gemini ย้ายไป aiProvider แล้ว
async function* streamGemini(
    systemPrompt,
    messages,
    maxTokens = 4096,
    { jsonMode = false, webContext = '' } = {},
) {
    const combinedPrompt = webContext
        ? `${systemPrompt}\n\nข้อมูลเสริมจากเว็บ (ยังไม่ยืนยันในฐานข้อมูล ใช้ประกอบการตอบเท่านั้น):\n${webContext}`
        : systemPrompt;
    yield* chatCompletionStream({
        systemPrompt: combinedPrompt,
        messages,
        maxTokens,
        // แชททั่วไปตอบเป็นธรรมชาติ แผน/JSON จะส่ง jsonMode มาเอง
        temperature: jsonMode ? 0.35 : 0.7,
        jsonMode,
    });
}

// แผนเที่ยวขอเป็น response เดียวเพื่อไม่ต้องต่อ JSON ที่ถูกแบ่งเป็น SSE หลายชิ้น
// ขอ JSON จาก 9router (response_format json_object) พร้อม retry ใน aiProvider
async function generateGeminiJson(systemPrompt, userPrompt, maxTokens = 8192) {
    // 9router ไม่รองรับ responseJsonSchema แบบ Gemini จึงย้ำ schema ใน prompt แทน
    // (PLAN_RESPONSE_SCHEMA ยังใช้เป็นเอกสารอ้างอิง + ส่งย้ำรูปแบบใน userPrompt ของ generateTripPlan)
    const result = await chatCompletion({
        systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        maxTokens,
        jsonMode: true,
        temperature: 0.25,
    });
    return {
        text: result.text,
        finishReason: result.finishReason,
        usageMetadata: result.usage || null,
    };
}

// สร้างแผนแล้ว stream สถานะกลับ Flutter ก่อนบันทึก JSON ที่ normalize ลงฐานข้อมูล
// สร้างแผนท่องเที่ยวด้วย Gemini แล้วส่งความคืบหน้าผ่าน SSE
async function generateTripPlan(tripId, tripInput, res) {
    const allowedTransportModes = getAllowedTransportModes(tripInput.transport_modes);
    const supportsLongDistance = allowedTransportModes.some(
        (mode) => LONG_DISTANCE_TRANSPORT_MODES.has(mode),
    );
    const mustVisitRequests = getMustVisitRequests(tripInput.must_visit);
    const mustVisitPlaces = await retrievePlacesByIds(
        mustVisitRequests.map((place) => place.id),
    );

    // ชื่อแผนที่ผู้ใช้กรอก (เช่น "เที่ยวเกาะทั่วไทย") — ใช้เป็นธีมหลักทั้งตอนค้น (RAG) และตอนสั่ง AI
    const tripTitle = typeof tripInput.title === 'string' ? tripInput.title.trim().slice(0, 120) : '';
    // ดึง relevant places จาก RAG
    const ragQuery = [
        tripTitle,
        tripInput.destination || 'สถานที่ท่องเที่ยวใกล้ฉัน',
        ...(tripInput.interests || []),
        tripInput.travel_style || '',
    ].filter((part) => typeof part === 'string' && part.trim()).join(' ');

    let places;
    if (tripInput.province) {
        places = await retrieveRelevantPlaces(ragQuery, {
            province: tripInput.province,
            limit: 15,
        });
    } else if (tripInput.start_latitude != null && tripInput.start_longitude != null) {
        const nearbyPlaces = await retrieveNearbyPlaces(
            tripInput.start_latitude,
            tripInput.start_longitude,
            15,
        );
        if (supportsLongDistance) {
            const nationwidePlaces = await retrieveRelevantPlaces(ragQuery, {
                province: null,
                limit: 20,
            });
            places = [...new Map(
                [...nearbyPlaces, ...nationwidePlaces].map((place) => [place.id, place]),
            ).values()];
        } else {
            places = nearbyPlaces;
        }
    } else {
        places = await retrieveRelevantPlaces(ragQuery, {
            province: null,
            limit: 15,
        });
    }

    places = mergePlaces(mustVisitPlaces, places);
    // แผนไม่มีที่พักแล้ว — กรองหมวด hotel/accommodation ออกจาก pool ที่ AI เลือกได้
    // (สถานที่ที่ผู้ใช้บังคับเลือกเองยังเคารพเหมือนเดิมผ่าน ensureMustVisitStops)
    const LODGING_CATEGORIES = new Set(['hotel', 'accommodation']);
    places = places.filter(
        (place) => !LODGING_CATEGORIES.has(String(place?.category || '').trim().toLowerCase()),
    );
    // มี must-visit = ทริปใช้เฉพาะที่ผู้ใช้เลือกเท่านั้น ห้ามเพิ่มที่อื่น
    // (pool เหลือแค่ที่เลือก — ที่เลือกเองเป็น hotel ก็ได้ เพราะผู้ใช้เลือกชัด)
    const exclusiveMustVisit = mustVisitPlaces.length > 0;
    if (exclusiveMustVisit) {
        places = [...mustVisitPlaces];
    }

    // ---- เวลาเริ่ม + จำนวนวัน (resolve ก่อนสร้าง prompt) ----
    // start_time "HH:MM" จากฟอร์ม — ใช้ไม่ได้ให้เริ่ม 09:00
    const dayStartMinutes = parseStartTimeInput(tripInput.start_time);
    const dayStartClock = formatClock(dayStartMinutes);
    // auto_days (หรือ days หาย/invalid) = ให้ระบบประเมินจากระยะทาง+สถานที่
    // client เก่าส่ง days อย่างเดียว = ใช้ค่านั้นตรง ๆ 1..7
    const autoDays = tripInput.auto_days === true || tripInput.autoDays === true;
    const requestedDaysRaw = Number.parseInt(String(tripInput.days ?? ''), 10);
    const requestedDays = Number.isInteger(requestedDaysRaw)
        ? Math.min(7, Math.max(1, requestedDaysRaw))
        : null;
    // ระยะไกลสุดจากจุดเริ่มต้นจริงถึงสถานที่บังคับ (ใช้พิกัด DB ก่อน, fallback พิกัดที่ client ส่งมา)
    const mustVisitCoords = (mustVisitPlaces.length > 0 ? mustVisitPlaces : mustVisitRequests)
        .map((place) => ({ latitude: place.latitude, longitude: place.longitude }))
        .filter((place) => finiteCoord(place.latitude) != null && finiteCoord(place.longitude) != null);
    const farthestKm = maxDistanceFromStart(
        tripInput.start_latitude,
        tripInput.start_longitude,
        mustVisitCoords,
    );
    const recommended = estimateRecommendedDays({
        mustVisitCount: Math.max(mustVisitPlaces.length, mustVisitRequests.length),
        maxDistanceKm: farthestKm,
        placeCount: places.length,
    });
    const effectiveDays = autoDays || requestedDays == null ? recommended.days : requestedDays;
    // สัญญาณเตือนล่วงหน้า (place-first): ขาไกลสุดกินเวลากว่าครึ่งวัน หรือวันที่กำหนดน้อยกว่าที่ประเมิน
    const earlyWarnings = [];
    if (farthestKm > 0) {
        const primaryMode = allowedTransportModes[0] || 'car';
        const { travelMinutes } = computeLegMinutes(farthestKm, primaryMode);
        if (travelMinutes > DAY_BUDGET_MINUTES / 2) {
            earlyWarnings.push(
                `สถานที่ที่เลือกอยู่ไกลจากจุดเริ่มต้น ~${Math.round(farthestKm)} กม. ` +
                `ใช้เวลาเดินทางขาเดียว ~${(travelMinutes / 60).toFixed(1)} ชม. ด้วย${primaryMode} ` +
                `— ควรเพิ่มวันหรือเลือกสถานที่ใกล้ขึ้น`,
            );
        }
    }
    if (!autoDays && requestedDays != null && requestedDays < recommended.days) {
        earlyWarnings.push(
            `กำหนด ${requestedDays} วัน แต่อาจต้องใช้ ~${recommended.days} วัน ` +
            `(ระยะไกลสุด ~${recommended.maxDistanceKm} กม.) — แผนอาจแน่นเกินไป`,
        );
    }

    const placesContext = formatPlacesContext(places);
    const mustVisitDescription = formatMustVisitList(
        mustVisitPlaces,
        mustVisitRequests,
    );

    // มี must-visit = ทริปใช้เฉพาะที่ผู้ใช้เลือกเท่านั้น ห้ามเพิ่มที่อื่น
    const placeSelectionRules = exclusiveMustVisit
        ? `ทริปนี้ใช้เฉพาะสถานที่ที่ผู้ใช้บังคับเลือก ${mustVisitPlaces.length} แห่งด้านล่างเท่านั้น ห้ามเพิ่มสถานที่อื่นใดทั้งสิ้น — กระจายให้ครบทุกที่ลงใน ${effectiveDays} วัน เรียงลำดับตามภูมิศาสตร์เพื่อลดการย้อนเส้นทาง`
        : `สถานที่ที่ผู้ใช้บังคับเลือกทั้งหมดต้องอยู่ใน stops ของทริปอย่างน้อย 1 ครั้ง และมีความสำคัญเหนือความสนใจ วิธีเดินทาง งบประมาณ และรายการที่ลบซ้ำถ้าขัดกัน — จัดกลุ่มวันและลำดับทริปโดยยึดสถานที่เหล่านี้เป็นหลัก
    เลือกสถานที่อื่นจากฐานข้อมูลเท่านั้น ให้เหมาะกับความสนใจและงบประมาณ จัดลำดับจากจุดเริ่ม GPS เพื่อลดการย้อนเส้นทาง`;

    const systemPrompt =
        `คุณคือผู้เชี่ยวชาญวางแผนการท่องเที่ยวในประเทศไทย
    ตอบเป็นภาษาไทยเสมอ และตอบในรูปแบบ JSON ที่กำหนดเท่านั้น ห้ามมีข้อความอื่นนอก JSON

    ข้อบังคับสำคัญ:
    - ทุก stop ต้องเลือกจากข้อมูลสถานที่ในฐานข้อมูลด้านล่างเท่านั้น
    - ห้ามเพิ่มชื่อสถานที่จากความรู้ของโมเดล ห้ามเดาสถานที่ และห้ามสร้าง URL รูปภาพเอง
    - ต้องคัดลอก destinationId, ชื่อ, พิกัด และ imageUrl จากข้อมูลฐานข้อมูลตรงตัว
    - ถ้าข้อมูลมีน้อย ให้สร้างแผนจากรายการที่มีเท่านั้น ห้ามเติมสถานที่อื่นให้ครบจำนวนวัน
    - พยายามจัดกลุ่มสถานที่บนเกาะและบนฝั่งเป็นช่วงเดียวกัน เลี่ยงลำดับ เกาะ → ฝั่ง → เกาะ หรือ ฝั่ง → เกาะ → ฝั่ง ในวันเดียวกัน (ไม่ว่าจะใช้พาหนะชนิดใด) แต่ถ้าจำเป็นต้องข้ามให้ใส่ได้
    - พยายามให้ข้ามระหว่างเกาะกับฝั่งไม่เกินหนึ่งครั้งต่อวัน ไม่ว่าจะใช้พาหนะชนิดใด (car/bus/train/ferry/bicycle/walking) ถ้าเกินให้ระบุใน tips ว่าอาจเหนื่อยจากการข้ามบ่อย เว้นแต่จำเป็นต่อสถานที่ที่ผู้ใช้บังคับเลือก
    - กรอบเวลาต่อวัน ~10 ชม. รวมเที่ยว+เดินทาง+พัก วันละไม่เกิน 5 จุด อย่ายัดหลายแห่งจนเวลาซ้อนกัน
    - ห้ามจัดเที่ยวดึก: ที่เที่ยวทุกจุดต้องถึงก่อน 21:00 และออกจากที่เที่ยวไม่เกิน 22:00 (เริ่มวันละ ${dayStartClock} บวกกรอบ 10 ชม. ต้องจบไม่เกิน 22:00) ถ้าสถานที่ไกลจนไปถึงดึก ให้กระจายไปวันอื่นแทน อย่ายัดลงวันเดียว
    - ดูเวลาเปิด-ปิดของแต่ละสถานที่ในข้อมูลด้านล่างก่อนจัดลำดับ: อย่าจัดให้ถึงนอกเวลาเปิด-ปิด (เช่น พิพิธภัณฑ์/อุทยานที่ปิด 16:00-18:00 ต้องไปกลางวัน, ตลาดกลางคืน/ถนนคนเดินไปได้เย็น-ค่ำ) ถ้าไม่รู้เวลาเปิดให้จัดช่วงกลางวันไว้ก่อน
    - ห้ามสร้าง stop แวะพัก/ปั๊มน้ำมัน/ที่พักค้างคืน/สนามบินเองเด็ดขาด — แผนมีเฉพาะสถานที่ท่องเที่ยวจากฐานข้อมูลเท่านั้น
    - arrivalTime กับ segments จะถูกระบบคำนวณใหม่จากระยะทางจริงหลัง AI ตอบ จึงไม่ต้องเดาเวลาเดินทางเอง แต่ทุก stop ต้องใส่ arrivalTime "HH:MM" กับ durationMinutes (20-300 นาที) ที่สมเหตุสมผลมาด้วย

    ข้อมูลสถานที่จากฐานข้อมูล:
    ${placesContext}`;

    const userPrompt =
        `สร้างแผนเที่ยว ${effectiveDays} วัน โดยเริ่มออกเดินทาง ${dayStartClock} ของทุกวัน จาก GPS ${tripInput.start_latitude}, ${tripInput.start_longitude}
${tripTitle ? `\n    ชื่อแผนที่ผู้ใช้ตั้ง: "${tripTitle}" — ใช้เป็นธีมหลักของทริป เลือกสถานที่และเขียน summary/theme ให้สอดคล้องกับชื่อนี้` : ''}

    ข้อมูลผู้เดินทาง:
    - งบประมาณ: ${tripInput.budget} ${tripInput.currency || 'THB'}
    - สไตล์การท่องเที่ยว: ${tripInput.travel_style || 'ไม่ระบุ'}
    - ประเภทกลุ่ม: ${tripInput.group_type || 'ไม่ระบุ'}
    - ความสนใจ: ${(tripInput.interests || []).join(', ') || 'ไม่ระบุ'}
    - พื้นที่/จังหวัด (ถ้ามี): ${tripInput.destination || 'ให้เลือกจากตำแหน่ง GPS'}
    - วิธีเดินทางที่ยอมรับ: ${allowedTransportModes.join(', ')}
    - รถยนต์คือรถส่วนตัวของผู้ใช้ (ไม่มีค่าเช่า/แท็กซี่): ประเมิน transportCost ทุกขารถยนต์ตามค่าน้ำมัน ~3 บาท/กม.
    - สถานที่ที่ผู้ใช้บังคับเลือก: ${mustVisitDescription}
    - สถานที่ที่ผู้ใช้ลบและห้ามเสนอซ้ำ: ${(tripInput.excluded_places || []).join(', ') || 'ไม่มี'}
    - เวลาเริ่มเดินทางแต่ละวัน: ${dayStartClock}
    - กรอบเวลาต่อวัน ~10 ชม. (รวมเที่ยว เดินทาง และพัก) วันละไม่เกิน ${MAX_STOPS_PER_DAY} จุด

    ${placeSelectionRules}
    ห้ามเสนอหรือสร้าง stop ที่ไม่มีอยู่ในข้อมูลสถานที่จากฐานข้อมูล แม้จำนวนสถานที่จะไม่พอกับจำนวนวัน
    transportMode ของแต่ละ stop หมายถึงพาหนะหลักที่ใช้เดินทางมาจาก stop ก่อนหน้า และต้องเลือกจากวิธีเดินทางที่ผู้ใช้ยอมรับเท่านั้น
    ถ้าวิธีเดินทางที่ผู้ใช้เลือกไม่เหมาะกับสถานที่บังคับเลือก ให้ยังคงใส่สถานที่นั้นในแผนและระบุใน tip ให้ตรวจสอบวิธีเดินทางจริง
    แต่ละ stop เลือก transportMode ต่างกันได้ตามความเหมาะสม ห้ามใช้รถยนต์ จักรยาน หรือเดินข้ามทะเล
    ถ้าเป็นรถไฟหรือเรือ ให้ใส่ segments แยกช่วงไปสถานี/ท่าเรือ ช่วงขนส่งหลัก และช่วงต่อไปยังจุดหมาย โดยใช้ชื่อจุดเชื่อมต่อจริงที่มั่นใจเท่านั้น
    ห้ามใช้เครื่องบิน (flight) เด็ดขาด — ระบบนี้เดินทางภาคพื้นและทางเรือเท่านั้น ใช้ ferry สำหรับการข้ามเกาะ/ทะเล, train สำหรับเส้นทางรถไฟ, bus/car/bicycle สำหรับถนน (จักรยานเฉพาะระยะที่ปั่นได้จริง) และ walking เฉพาะระยะที่เดินได้จริง
    ห้ามแต่งรอบเรือ รอบรถไฟ หรือเวลาออกเดินทางจริง หากไม่มีข้อมูลตารางเวลา ให้ระบุใน tip ว่าเป็นเวลาโดยประมาณและควรตรวจสอบตารางกับผู้ให้บริการ
    ถ้าผู้ใช้อนุญาตวิธีเดินทางระยะไกลและไม่ได้จำกัดจังหวัด สามารถวางแผนหลายจังหวัดได้เมื่อจำนวนวันและงบประมาณเหมาะสม แต่ไม่จำเป็นต้องฝืนเดินทางไกล
    ค่าใช้จ่ายทั้งหมดเป็นค่าประมาณต่อทริป และทุก stop ต้องมี latitude/longitude ที่ใช้งานบนแผนที่ได้

    ตอบในรูปแบบ JSON นี้เท่านั้น:
    {
    "summary": "สรุปแผนเที่ยว 2-3 ประโยค",
    "totalEstimatedCost": 0,
    "budgetBreakdown": {
        "food": 0,
        "transport": 0,
        "activities": 0
    },
    "days": [
        {
        "day": 1,
        "theme": "ธีมของวัน",
        "stops": [{
          "destinationId": 0, "place": "", "activity": "", "latitude": 0, "longitude": 0,
          "imageUrl": "", "arrivalTime": "09:00", "durationMinutes": 90, "entryCost": 0,
          "foodCost": 0, "transportMode": "car", "transportCost": 0, "tip": "",
          "segments": [{"mode":"car", "from":"", "to":"", "estimatedMinutes":0, "estimatedCost":0}]
        }]
        }
    ],
    "mustEat": ["อาหารที่ต้องลอง 1", "อาหารที่ต้องลอง 2"],
    "tips": ["เคล็ดลับการเดินทาง 1", "เคล็ดลับ 2"],
    "warnings": ["คำเตือนถ้าวันแน่นหรือระยะไกลเกิน (ถ้าไม่มีให้เป็น [])"]
    }`;

    // ตั้ง SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
        if (places.length === 0) {
            const noDatabasePlaces = new Error('No database destinations were retrieved for this plan');
            noDatabasePlaces.code = 'NO_DATABASE_PLACES';
            throw noDatabasePlaces;
        }

        let fullText = '';
        let planData;
        let routeCorrection = '';

        for (let generationAttempt = 0; generationAttempt < 2; generationAttempt++) {
            const generated = await generateGeminiJson(
                systemPrompt,
                `${userPrompt}${routeCorrection}`,
            );
            fullText = generated.text;

            try {
                const withoutFences = fullText.replace(/```json|```/gi, '').trim();
                const firstBrace = withoutFences.indexOf('{');
                const lastBrace = withoutFences.lastIndexOf('}');
                if (firstBrace < 0 || lastBrace <= firstBrace) {
                    throw new SyntaxError('AI returned no complete JSON object');
                }
                const jsonText = withoutFences.slice(firstBrace, lastBrace + 1);
                try {
                    planData = JSON.parse(jsonText);
                } catch (strictError) {
                    const repaired = jsonrepair(jsonText);
                    planData = JSON.parse(repaired);
                    console.warn(`[ai] repaired malformed plan JSON: ${strictError.message}`);
                }
                if (!Array.isArray(planData.days) || planData.days.length === 0) {
                    throw new SyntaxError(
                        `AI plan JSON is missing days (keys=${Object.keys(planData).join(',')})`,
                    );
                }
                normalizePlanTransportModes(planData, allowedTransportModes);
                normalizePlanPlaces(planData, places);
                ensureMustVisitStops(planData, mustVisitPlaces, {
                    allowedTransportModes,
                    days: effectiveDays,
                });
                normalizePlanTransportModes(planData, allowedTransportModes);
                normalizePlanPlaces(planData, places);
                const ferryViolations = findExcessIslandCrossings(
                    planData,
                    mustVisitPlaces,
                    places,
                );
                if (ferryViolations.length > 0) {
                    // ไม่ทิ้ง error — คำนวณใหม่โดยจัดกลุ่มเกาะ/ฝั่งให้เหลือข้ามไม่เกิน 1 ครั้ง/วัน
                    console.warn(`[ai] plan has island crossings: ${formatIslandViolations(ferryViolations)} — regrouping`);
                    const fixed = regroupIslandsToMinimizeCrossings(planData, places);
                    const afterFix = fixed
                        ? findExcessIslandCrossings(planData, mustVisitPlaces, places)
                        : ferryViolations;
                    if (afterFix.length > 0) {
                        // ยังเกินเพราะ mustVisit บังคับ — อนุญาตพร้อมคำเตือนแทนการทิ้งทริป
                        console.warn(`[ai] still has crossings after regroup: ${formatIslandViolations(afterFix)} — allowing with warning`);
                        planData.tips = Array.isArray(planData.tips) ? planData.tips : [];
                        const warning = `ทริปนี้มีการข้ามเกาะ↔ฝั่งมากกว่า 1 ครั้ง/วัน (${formatIslandViolations(afterFix)}) — เกิดจากสถานที่ที่บังคับเลือกกระจัดกระจาย`;
                        if (!planData.tips.includes(warning)) planData.tips.push(warning);
                    } else if (fixed) {
                        planData.tips = Array.isArray(planData.tips) ? planData.tips : [];
                        const info = 'จัดกลุ่มสถานที่บนเกาะและบนฝั่งใหม่ให้อัตโนมัติเพื่อลดการข้ามไปมา';
                        if (!planData.tips.includes(info)) planData.tips.push(info);
                        console.warn('[ai] island crossings fixed by regrouping');
                    }
                }
                // ---- จัดลำดับ + เดินโซ่เวลา deterministic (เขียนทับเวลาที่ AI เดามา) ----
                // จัดลำดับจากจุดเริ่มต้นจริงแล้วเดินโซ่ ถึง→เที่ยว→ออก→เดินทาง→ถึง ต่อเนื่องทั้งวัน
                // วันแรก origin = GPS ผู้ใช้, วันถัดไป origin = จุดสุดท้ายของวันก่อน
                applyDeterministicSchedule(planData, {
                    startLat: tripInput.start_latitude,
                    startLng: tripInput.start_longitude,
                    startMinutes: dayStartMinutes,
                    startName: 'จุดเริ่มต้น',
                    primaryMode: allowedTransportModes[0] || 'car',
                });
                // ---- กันเที่ยวดึก: วันที่ล้นถึง ≥21:00 / เกิน 22:00 ให้ย้ายจุดที่เหลือไปวันถัดไป ----
                // (สร้างวันใหม่สูงสุด 7 วัน วันใหม่เริ่มเช้าใหม่ — แก้เคส ถึง 23:09 / 00:45 / 03:21)
                try {
                    const { moved, createdDays } = splitOverflowingDays(planData, {
                        startMinutes: dayStartMinutes,
                    });
                    if (moved > 0) {
                        console.warn(`[ai] split ${moved} late-night stops to next day (+${createdDays} days)`);
                        await tripRepository.updateTripDays(tripId, planData.days.length).catch(() => {});
                    }
                } catch (splitError) {
                    console.warn(`[ai] split overflowing days skipped: ${splitError.message}`);
                }
                // ---- ซ่อมจุดที่หลุดเวลาเปิด-ปิด: ลองสลับลำดับในวันเดียวกันให้ตรงเวลาเปิด ----
                // (best-effort ซ่อมไม่ได้คงเดิม + เตือนผ่าน warnings ข้างล่าง)
                try {
                    const { fixed } = repairDayOpeningOrder(planData, places, {
                        startLat: tripInput.start_latitude,
                        startLng: tripInput.start_longitude,
                        startMinutes: dayStartMinutes,
                        primaryMode: allowedTransportModes[0] || 'car',
                    });
                    if (fixed > 0) {
                        console.warn(`[ai] reordered ${fixed} stops to fit opening hours`);
                    }
                } catch (repairError) {
                    console.warn(`[ai] opening-hours repair skipped: ${repairError.message}`);
                }
                // รถยนต์ทุกคันคือรถส่วนตัว: เขียนทับขารถยนต์ทุกขา (รวมที่ AI เดามา)
                // เป็นค่าน้ำมัน ~3 บาท/กม. จ่ายตามระยะจริง
                {
                    applyCarFuelCosts(planData, {
                        startLat: tripInput.start_latitude,
                        startLng: tripInput.start_longitude,
                    });
                    planData.tips = Array.isArray(planData.tips) ? planData.tips : [];
                    const fuelTip = 'ค่าเดินทางรถยนต์คิดตามค่าน้ำมันรถส่วนตัว (~3 บาท/กม.)';
                    if (!planData.tips.includes(fuelTip)) planData.tips.push(fuelTip);
                }
                const { warnings: fitWarnings } = validateDayFit(planData);
                // ตรวจเที่ยวดึก + นอกเวลาเปิด-ปิดจากข้อมูล DB จริง (places มี opening_time/closing_time)
                const timeWarnings = validateOpeningAndLateNight(planData, places);
                const allWarnings = [...new Set([...earlyWarnings, ...fitWarnings, ...timeWarnings])];
                if (allWarnings.length > 0) {
                    planData.warnings = allWarnings;
                    planData.tips = Array.isArray(planData.tips) ? planData.tips : [];
                    for (const warning of allWarnings) {
                        if (!planData.tips.includes(warning)) planData.tips.push(warning);
                    }
                } else if (planData.warnings != null && !Array.isArray(planData.warnings)) {
                    delete planData.warnings;
                }
                if (planData.days.length === 0) {
                    const noVerifiedStops = new Error(
                        'The generated plan contained no database-backed destinations',
                    );
                    noVerifiedStops.code = 'NO_DATABASE_PLACES';
                    throw noVerifiedStops;
                }
                break;
            } catch (parseError) {
                console.warn(
                    `[ai] invalid plan JSON attempt ${generationAttempt + 1}/2: ${parseError.message}; ` +
                    `length=${fullText.length}; finishReason=${generated.finishReason}; ` +
                    `usage=${JSON.stringify(generated.usageMetadata)}`,
                );
                if (generationAttempt === 1) throw parseError;
                await wait(150);
            }
        }

        // เก็บจำนวนวันที่ resolve แล้ว (auto_days คำนวณได้กี่วันก็เก็บเท่านั้น)
        await tripRepository.updateTripDays(tripId, effectiveDays);

        // บันทึกแผนการเดินทางลง trip_plans
        await tripRepository.saveGeneratedPlan(tripId, planData, fullText);

        // อัปเดตสถานะการเดินทางเป็นเสร็จสิ้น
        await tripRepository.markTripDone(tripId);

        if (Array.isArray(planData.warnings) && planData.warnings.length > 0) {
            res.write(`data: ${JSON.stringify({ type: 'warning', warnings: planData.warnings })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ type: 'done', tripId })}\n\n`);
    } catch (err) {
        console.error('[ai] generateTripPlan error:', err.message);
        await tripRepository.markTripFailed(tripId);
        const transient = err instanceof SyntaxError || err.statusCode === 429 || err.statusCode >= 500;
        const message = err.code === 'NO_DATABASE_PLACES'
            ? 'ไม่พบสถานที่จากฐานข้อมูลเพียงพอสำหรับสร้างแผน กรุณาเพิ่มหรือนำเข้าข้อมูลสถานที่ก่อน'
            : err.code === 'EXCESSIVE_FERRY_CROSSINGS'
                ? 'ไม่สามารถจัดแผนที่ลดการข้ามเกาะและฝั่งได้ กรุณาเลือกสถานที่หรือจังหวัดให้แคบลง'
            : transient
                ? 'The AI travel planner is temporarily busy. Please try again in a moment.'
                : 'The travel plan could not be generated. Please review your details and try again.';
        res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
    } finally {
        res.end();
    }
}

// ตรวจสอบว่าข้อความเป็นคำถามเกี่ยวกับการท่องเที่ยวหรือไม่
function isTravelRelatedQuery(message) {
    const travelKeywords = [
        // Thai keywords
        'ที่เที่ยว', 'สถานที่', 'เที่ยว', 'ไป', 'จังหวัด', 'หา', 'แนะนำ', 'ร้าน', 'อาหาร', 
        'รีสอร์ท', 'โรงแรม', 'ที่พัก', 'ภาพ', 'สแกน', 'ป้าย', 'เส้นทาง', 'เดินทาง', 'พิกัด',
        'ระยะทาง', 'เวลา', 'เปิด', 'ปิด', 'ราคา', 'ค่าเข้า', 'ค่าบริการ', 'กิจกรรม', 'ช้อปปิ้ง',
        'ตลาด', 'วัด', 'พิพิธภัณฑ์', 'ชายหาด', 'ภูเขา', 'น้ำตก', 'อุทยาน', 'เกาะ', 'ทะเล', 'ป่า',
        // English keywords
        'place', 'travel', 'trip', 'visit', 'go', 'location', 'recommend', 'restaurant', 'food',
        'resort', 'hotel', 'stay', 'image', 'scan', 'sign', 'route', 'direction', 'coordinate',
        'distance', 'time', 'open', 'close', 'price', 'fee', 'cost', 'activity', 'shopping',
        'market', 'temple', 'museum', 'beach', 'mountain', 'waterfall', 'park', 'island', 'sea', 'forest'
    ];
    
    const lowerMessage = message.toLowerCase();
    return travelKeywords.some(keyword => lowerMessage.includes(keyword));
}

// ฟังก์ชันแชทที่ใช้การค้นคืนข้อมูล ragChat()
// ตอบคำถามเกี่ยวกับแผนเที่ยว ด้วย RAG + chat history
// ส่งกลับไป Flutter พร้อมบันทึก source_chunk_ids
// สร้างคำตอบแชทจากบริบทสถานที่ RAG และ stream ผลลัพธ์ให้ผู้ใช้
async function ragChat(
    sessionId,
    userMessage,
    chatHistory,
    res,
    { existingUserMessageId = null } = {},
) {
    // ตรวจสอบว่าเป็นคำถามเกี่ยวกับการท่องเที่ยวหรือไม่
    const isTravelQuery = isTravelRelatedQuery(userMessage);

    let places = [];
    let placesContext = '';
    let sourceChunkIds = [];

    // ใช้ RAG เฉพาะเมื่อเป็นคำถามเกี่ยวกับการท่องเที่ยว
    if (isTravelQuery) {
        // RAG: embed คำถาม → ดึง relevant places
        places = await retrieveRelevantPlaces(userMessage, {
            limit: 8,
        });
    }

    // vector search คืนผลใกล้เคียงสุดเสมอแม้ไม่เกี่ยว (SQL ไม่มี threshold)
    // จึงดูคะแนนสูงสุด: ต่ำกว่าเกณฑ์ = DB ไม่มีข้อมูลที่เกี่ยวข้อง → ไปค้นเว็บแทน
    // (เดิมเช็คแค่ places.length === 0 ซึ่งแทบไม่เกิด ทำให้ web search ไม่มีวันทำงาน)
    const maxSimilarity = places.reduce(
        (best, place) => Math.max(best, Number(place.similarity) || 0),
        0,
    );
    const hasRelevantDbData = isTravelQuery
        && places.length > 0
        && maxSimilarity >= config.rag.chatSimilarityThreshold;
    const relevantPlaces = hasRelevantDbData ? places : [];
    if (isTravelQuery && places.length > 0 && !hasRelevantDbData) {
        console.warn(
            `[ai] RAG top similarity ${maxSimilarity.toFixed(4)} < ${config.rag.chatSimilarityThreshold} — ถือว่า DB ไม่มีข้อมูล ไปค้นเว็บแทน`,
        );
    }

    placesContext = formatPlacesContext(relevantPlaces);
    sourceChunkIds = relevantPlaces.map((place) => place.id);

    // ค้นเว็บฟรี (Tavily หลัก + Wikipedia/DuckDuckGo สำรอง) เฉพาะเมื่อ DB
    // ไม่มีข้อมูลที่เกี่ยวข้อง — ประหยัดเครดิต Tavily (1 call ต่อ 1 เทิร์น)
    const useWebSearch = isTravelQuery && !hasRelevantDbData && config.webSearch.enabled;
    let webResults = [];
    let webContext = '';
    if (useWebSearch) {
        try {
            webResults = await freeWebSearch(userMessage, {
                limit: config.webSearch.maxResults,
            });
            webContext = formatWebSearchContext(webResults);
        } catch (error) {
            console.warn(`[ai] free web search failed: ${error.message}`);
            webResults = [];
            webContext = '';
        }
    }

    const travelGuideRules = `คุณคือ AI Guide สำหรับการท่องเที่ยวและวัฒนธรรมไทย
    ตอบเป็นภาษาเดียวกับข้อความล่าสุดของผู้ใช้ และใช้ภาษาอังกฤษเป็นค่าเริ่มต้นเมื่อระบุภาษาไม่ได้
    ตอบคำถามเกี่ยวกับการท่องเที่ยว สถานที่ ป้ายภาษาไทย อาหารไทย และผลการสแกนก่อนหน้า
    ใช้ chat history เมื่อตอบคำถามต่อเนื่องเกี่ยวกับรูปที่เพิ่งสแกน แต่ต้องคงระดับความไม่แน่นอนจากผลเดิม
    ห้ามยืนยันสารก่อภูมิแพ้ ส่วนผสมทั้งหมด หรือสถานะฮาลาลจากภาพอาหารเพียงอย่างเดียว
    ห้ามใช้ markdown formatting เช่น **, *, #, -, หรือสัญลักษณ์อื่นๆ ในคำตอบ ตอบเป็นข้อความธรรมดาเท่านั้น`;

    const webAnswerRules = webResults.length > 0
        ? `ไม่พบข้อมูลสถานที่ที่เกี่ยวข้องในฐานข้อมูลของแอป ให้ใช้ข้อมูลเสริมจากเว็บด้านล่างช่วยตอบคำถาม
    สรุปจากผลค้นหาอย่างระมัดระวัง และระบุให้ผู้ใช้ทราบว่าข้อมูลนี้มาจากเว็บ ไม่ใช่สถานที่ที่ยืนยันในฐานข้อมูลของแอป
    ถ้าผลค้นหาไม่ชัดเจนหรือขัดแย้งกัน ให้แจ้งข้อจำกัดนั้นแทนการเดา
    ห้ามแปะ URL หรือลิงก์ดิบๆ ในคำตอบ ให้อ้างอิงแค่ชื่อแหล่งข้อมูลพอ`
        : `ไม่พบข้อมูลสถานที่ที่เกี่ยวข้องในฐานข้อมูลของแอป และค้นเว็บไม่พบผลลัพธ์
    ให้บอกผู้ใช้ตรงๆ ว่ายังไม่มีข้อมูลยืนยันสำหรับคำถามนี้ แนะนำให้ถามให้ชัดเจนเฉพาะเจาะจงเพิ่มเติม`;

    const systemPrompt = isTravelQuery ?
    (hasRelevantDbData ?
    `${travelGuideRules}
    สำหรับข้อมูลสถานที่ ให้ยึด context จากฐานข้อมูลเป็นหลัก ถ้าข้อมูลไม่อยู่ใน context ให้บอกตรงๆ ว่าไม่มีข้อมูลยืนยัน
    หากมีข้อมูลบางส่วนหรือสถานที่ย่อยที่เกี่ยวข้องกันในพื้นที่ ให้แจ้งข้อมูลนั้นโดยตรงทันที
    เมื่อแนะนำสถานที่ ให้พูดถึงสถานที่ที่มีใน context หลายแห่งตามความเหมาะสม และเขียนชื่อสถานที่ให้ตรงกับชื่อใน context ทุกครั้ง
    คำตอบทุกครั้งต้องมีเนื้อหาครบถ้วน ยาวอย่างน้อย 5 ประโยค ห้ามตอบสั้นเด็ดขาด แม้คำถามจะสั้นหรือเป็นคำถามปิด เช่น น่าเที่ยวไหม ดีไหม ก็ต้องตอบพร้อมเหตุผลและรายละเอียด
    โครงสร้างคำตอบที่ต้องมี: คำตอบตรงคำถามก่อน 1 ประโยค แล้วขยายด้วยจุดเด่นและสิ่งที่ทำได้ที่สถานที่นั้น ข้อมูลประกอบที่มีใน context เช่น ค่าเข้า เวลาเปิด กิจกรรม และคำแนะนำปิดท้ายสำหรับคนที่สนใจไป
    ถ้า context มีข้อมูลน้อย ให้เล่าเพิ่มจากส่วนที่มี เช่น หมวดหมู่ จังหวัด พิกัด หรือสถานที่ใกล้เคียงใน context แทนการตอบสั้น
    ห้ามตอบสั้นหรือตัดคำตอบค้างไว้ ให้เขียนจนจบเรื่อง

    ข้อมูลสถานที่ที่เกี่ยวข้อง:
    ${placesContext}` :
    `${travelGuideRules}
    ${webAnswerRules}`) :
    `คุณคือ AI Guide สำหรับการท่องเที่ยวและวัฒนธรรมไทย
    ตอบเป็นภาษาเดียวกับข้อความล่าสุดของผู้ใช้ และใช้ภาษาอังกฤษเป็นค่าเริ่มต้นเมื่อระบุภาษาไม่ได้
    คุยตามปกติเหมือนเพื่อน ตอบคำถามทั่วไปได้อย่างอิสระ
    หากผู้ใช้ถามเกี่ยวกับการท่องเที่ยว สถานที่ หรือข้อมูลที่ต้องการข้อมูลจากฐานข้อมูล ให้แนะนำให้ถามให้ชัดเจนเฉพาะเจาะจงเพิ่มเติม
    อย่าพยายามแนะนำสถานที่ท่องเที่ยวโดยไม่มีข้อมูลจากฐานข้อมูลที่เชื่อถือได้
    ห้ามใช้ markdown formatting เช่น **, *, #, -, หรือสัญลักษณ์อื่นๆ ในคำตอบ ตอบเป็นข้อความธรรมดาเท่านั้น`;

    // ตั้ง SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let fullAnswer = '';

    try {
        const messages = [
            ...chatHistory.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: userMessage },
        ];

        // ไม่แนบลิงก์ดิบในคำตอบ (แสดงผลไม่สวยในแชท) — โมเดลจะระบุเองว่าข้อมูลมาจากเว็บ
        for await (const token of streamGemini(systemPrompt, messages, 2048, {
            webContext,
        })) {
            fullAnswer += token;
            res.write(`data: ${JSON.stringify({ type: 'token', text: token })}\n\n`);
        }

        // กรองให้เหลือเฉพาะสถานที่ที่ AI พูดถึงจริงในคำตอบ เรียงตามลำดับที่ถูกกล่าวถึง
        // ถ้าไม่มีสถานที่ไหนถูกพูดถึงเลยจะไม่มี card (เคสตอบจากเว็บจะไม่ผูก card ของ DB ที่ไม่เกี่ยว)
        const sourcePlaces = pickPlacesMentionedInAnswer(fullAnswer, relevantPlaces);
        sourceChunkIds = sourcePlaces.map((place) => place.id);

        let userMessageId;
        let assistantMessageId;
        let deletedAssistantMessageIds = [];

        if (existingUserMessageId) {
            // อัปเดต prompt, ลบคำตอบเดิม และเพิ่มคำตอบใหม่ใน statement เดียว
            // จึงไม่ทิ้งบทสนทนาไว้ครึ่งทางหากบันทึกฐานข้อมูลล้มเหลว
            const saved = await chatRepository.replaceEditedMessage(sessionId, {
                userMessage,
                fullAnswer,
                sourceChunkIds,
                existingUserMessageId,
            });
            if (!saved) throw new Error('Editable chat message no longer exists');
            userMessageId = saved.user_message_id;
            assistantMessageId = saved.assistant_message_id;
            deletedAssistantMessageIds = saved.deleted_assistant_message_ids || [];
        } else {
            const saved = await chatRepository.insertChatMessagePair(sessionId, {
                userMessage,
                fullAnswer,
                sourceChunkIds,
            });
            if (!saved) throw new Error('Chat messages could not be saved');
            userMessageId = saved.user_message_id;
            assistantMessageId = saved.assistant_message_id;
        }

        const sources = sourcePlaces.map(place => ({
            id: place.id,
            name: place.name,
            province: place.province,
            category: place.category,
            image_url: place.image_url,
        }));
        res.write(`data: ${JSON.stringify({
            type: 'done',
            sourceChunkIds,
            sources,
            userMessageId,
            assistantMessageId,
            deletedAssistantMessageIds,
        })}\n\n`);
    } catch (err) {
        console.error('[ai] ragChat error:', err.message);
        res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    } finally {
        res.end();
    }
}

module.exports = { generateTripPlan, ragChat };
