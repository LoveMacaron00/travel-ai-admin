// server/controllers/helpers/aiHelper.js

const pool = require('../../config/db');
const query = pool.query.bind(pool);
const { jsonrepair } = require('jsonrepair');
const {
    retrieveRelevantPlaces,
    retrieveNearbyPlaces,
    retrievePlacesByIds,
    formatPlacesContext,
} = require('./ragHelper');
const { ensureMustVisitStops, normalizePlanPlaces } = require('./planPlaceNormalizer');
const { config } = require('../../config/env');
const GEMINI_API_KEY = config.gemini.apiKey;
const GEMINI_API_BASE = config.gemini.apiBaseUrl;
const GEMINI_MODEL = config.gemini.model;
const GEMINI_MAX_RETRIES = config.gemini.maxRetries;
const GEMINI_PLAN_THINKING_BUDGET = config.gemini.planThinkingBudget;
const SUPPORTED_TRANSPORT_MODES = new Set([
    'car',
    'walking',
    'bus',
    'train',
    'ferry',
    'flight',
]);
const LONG_DISTANCE_TRANSPORT_MODES = new Set(['train', 'ferry', 'flight']);
const GEMINI_HEADERS = {
    'Content-Type': 'application/json',
    // ส่ง key ใน header เพื่อไม่ให้ค่าลับติด URL หรือ access log
    'x-goog-api-key': GEMINI_API_KEY,
};

// หน่วงเวลาแบบ async สำหรับการ retry request ไปยัง Gemini
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Gemini รุ่น 1.5 ใช้ tool ชื่อ google_search_retrieval ส่วน 2.0 ขึ้นไปใช้ google_search
const googleSearchTool = () =>
    /gemini-1\.[05]/.test(GEMINI_MODEL)
        ? { google_search_retrieval: {} }
        : { google_search: {} };

// รวมแหล่งอ้างอิงเว็บจาก grounding metadata เป็นข้อความธรรมดาท้ายคำตอบ
const formatWebCitations = (chunks, userMessage) => {
    const seen = new Set();
    const citations = [];
    for (const chunk of chunks) {
        const uri = chunk?.web?.uri;
        if (!uri || seen.has(uri)) continue;
        seen.add(uri);
        citations.push(`${chunk.web.title || uri} (${uri})`);
        if (citations.length >= 3) break;
    }
    if (!citations.length) return '';
    const label = /[\u0E00-\u0E7F]/.test(userMessage)
        ? 'อ้างอิงจากเว็บ:'
        : 'Web sources:';
    return `${label}\n${citations.join('\n')}`;
};

// คัดเฉพาะรูปแบบการเดินทางที่ระบบรองรับจากข้อมูลนำเข้าของผู้ใช้
const getAllowedTransportModes = (modes) => {
    const allowed = Array.isArray(modes)
        ? modes
            .map((mode) => String(mode).trim().toLowerCase())
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
    for (const day of planData.days || []) {
        for (const stop of day.stops || []) {
            const mode = String(stop.transportMode || '').toLowerCase();
            stop.transportMode = allowedModes.includes(mode) ? mode : allowedModes[0];

            if (Array.isArray(stop.segments)) {
                for (const segment of stop.segments) {
                    const segmentMode = String(segment.mode || '').toLowerCase();
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

const ISLAND_KEYWORDS = ['เกาะ', 'หมู่เกาะ', 'island', 'islands', 'koh', 'ko.', 'เกาะช้าง', 'เกาะกูด', 'เกาะหมาก', 'เกาะพะงัน', 'เกาะเต่า', 'เกาะพีพี', 'เกาะลันตา', 'เกาะยาว', 'เกาะสมุย'];
const ISLAND_PROVINCE_KEYWORDS = ['ภูเก็ต', 'phuket'];

const normalizeIslandName = (value) => String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('th')
    .replace(/[^\p{L}\p{N}]+/gu, '');

const isIslandPlace = (place) => {
    if (!place || typeof place !== 'object') return false;
    const haystack = [
        place.name || '',
        place.category || '',
        Array.isArray(place.tags) ? place.tags.join(' ') : String(place.tags || ''),
        place.description || '',
        place.address || '',
        place.district || '',
        place.sub_district || '',
        place.province || '',
    ].join(' ').toLowerCase();
    if (ISLAND_PROVINCE_KEYWORDS.some((kw) => haystack.includes(kw.toLowerCase()))) return true;
    return ISLAND_KEYWORDS.some((kw) => haystack.includes(kw.toLowerCase()));
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
                // รู้ภูมิศาสตร์ทั้งสองจุด → นับเมื่อสลับ เกาะ↔ฝั่ง ไม่สนว่าใช้ car/bus/train/ferry/flight/walking อะไร
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

// alias เดิมเพื่อให้โค้ดอื่นที่เรียกชื่อเก่าไม่พัง และใช้ logic ใหม่ที่ครอบคลุมทุกพาหนะ
const findExcessFerryCrossings = findExcessIslandCrossings;

const formatFerryViolations = (violations) => violations
    .map((violation) =>
        `วันที่ ${violation.day || '?'}: ${violation.stops.map((stop) => stop.place).join(', ')}`,
    )
    .join('; ');

const formatIslandViolations = formatFerryViolations;

const PLAN_RESPONSE_SCHEMA = {
    type: 'object',
    required: ['summary', 'totalEstimatedCost', 'budgetBreakdown', 'days', 'tips'],
    properties: {
        summary: { type: 'string' },
        totalEstimatedCost: { type: 'number' },
        budgetBreakdown: {
            type: 'object',
            required: ['accommodation', 'food', 'transport', 'activities'],
            properties: {
                accommodation: { type: 'number' },
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
    },
};

// คืน async generator ที่ yield text delta เพื่อส่งต่อเป็น SSE โดยไม่รอคำตอบทั้งหมด
// เปิด googleSearch เพื่อให้โมเดลค้นเว็บเมื่อข้อมูลใน context ไม่พอ พร้อม onGrounding รับแหล่งอ้างอิง
async function* streamGemini(
    systemPrompt,
    messages,
    maxTokens = 4096,
    { jsonMode = false, googleSearch = false, onGrounding = null } = {},
) {

    const contents = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : m.role,
        parts: [{ text: m.content }]
    }));

    const body = {
        contents,
        generationConfig: {
            maxOutputTokens: maxTokens,
            temperature: 0.7,
        }
    };

    if (jsonMode) {
        body.generationConfig.responseMimeType = 'application/json';
        body.generationConfig.temperature = 0.35;
    }

    if (googleSearch) {
        body.tools = [googleSearchTool()];
    }

    if (systemPrompt) {
        body.systemInstruction = {
            parts: [{ text: systemPrompt }]
        };
    }

    const url = `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse`;

    let response;
    for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt++) {
        response = await fetch(url, {
            method: 'POST',
            headers: GEMINI_HEADERS,
            body: JSON.stringify(body),
        });

        if (response.ok) break;

        const errorBody = await response.text();
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        if (!retryable || attempt === GEMINI_MAX_RETRIES) {
            const error = new Error(`Gemini API error: ${response.status} — ${errorBody}`);
            error.statusCode = response.status;
            throw error;
        }

        const exponentialDelay = 1000 * (2 ** attempt);
        const jitter = Math.floor(Math.random() * 500);
        console.warn(`[ai] Gemini ${response.status}; retry ${attempt + 1}/${GEMINI_MAX_RETRIES} in ${exponentialDelay + jitter}ms`);
        await wait(exponentialDelay + jitter);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // บรรทัดสุดท้ายอาจยังไม่ครบ

        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6).trim();
            if (jsonStr === '[DONE]') return;

            try {
                const event = JSON.parse(jsonStr);
                const candidate = event.candidates?.[0];
                const text = candidate?.content?.parts?.[0]?.text;
                if (text) {
                    yield text;
                }
                if (onGrounding) {
                    const chunks = candidate?.groundingMetadata?.groundingChunks;
                    if (Array.isArray(chunks) && chunks.length > 0) onGrounding(chunks);
                }
            } catch {
                // ข้ามเฉพาะ SSE event ที่ถูกตัดกลางทาง แล้วอ่าน event ถัดไปต่อ
            }
        }
    }
}

// แผนเที่ยวขอเป็น response เดียวเพื่อไม่ต้องต่อ JSON ที่ถูกแบ่งเป็น SSE หลายชิ้น
// ขอ JSON ที่ซ่อมรูปแบบแล้วจาก Gemini พร้อม retry เมื่อเกิดข้อผิดพลาดชั่วคราว
async function generateGeminiJson(systemPrompt, userPrompt, maxTokens = 8192) {
    const url = `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent`;
    const body = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
            maxOutputTokens: maxTokens,
            temperature: 0.25,
            responseMimeType: 'application/json',
            responseJsonSchema: PLAN_RESPONSE_SCHEMA,
        },
    };

    // โมเดลใหม่บางรุ่นปฏิเสธ thinkingBudget เป็น 0 (400 INVALID_ARGUMENT)
    // จึงส่ง thinkingConfig เฉพาะเมื่อตั้งค่า budget มากกว่า 0 เท่านั้น
    if (GEMINI_PLAN_THINKING_BUDGET > 0) {
        body.generationConfig.thinkingConfig = {
            thinkingBudget: GEMINI_PLAN_THINKING_BUDGET,
        };
    }

    for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt++) {
        const response = await fetch(url, {
            method: 'POST',
            headers: GEMINI_HEADERS,
            body: JSON.stringify(body),
        });

        if (response.ok) {
            const payload = await response.json();
            const candidate = payload.candidates?.[0];
            const text = candidate?.content?.parts?.map(part => part.text || '').join('') || '';
            if (!text) {
                throw new Error(`Gemini returned no plan content (finishReason=${candidate?.finishReason || 'unknown'})`);
            }
            return {
                text,
                finishReason: candidate?.finishReason || 'UNKNOWN',
                usageMetadata: payload.usageMetadata || null,
            };
        }

        const errorBody = await response.text();
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        if (!retryable || attempt === GEMINI_MAX_RETRIES) {
            const error = new Error(`Gemini API error: ${response.status} — ${errorBody}`);
            error.statusCode = response.status;
            throw error;
        }
        const delay = 1000 * (2 ** attempt) + Math.floor(Math.random() * 500);
        console.warn(`[ai] Gemini ${response.status}; JSON retry ${attempt + 1}/${GEMINI_MAX_RETRIES} in ${delay}ms`);
        await wait(delay);
    }
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

    // ดึง relevant places จาก RAG
    const ragQuery = [
        tripInput.destination || 'สถานที่ท่องเที่ยวใกล้ฉัน',
        ...(tripInput.interests || []),
        tripInput.travel_style || '',
    ].join(' ');

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
    const placesContext = formatPlacesContext(places);
    const mustVisitDescription = formatMustVisitList(
        mustVisitPlaces,
        mustVisitRequests,
    );

    const systemPrompt =
        `คุณคือผู้เชี่ยวชาญวางแผนการท่องเที่ยวในประเทศไทย
    ตอบเป็นภาษาไทยเสมอ และตอบในรูปแบบ JSON ที่กำหนดเท่านั้น ห้ามมีข้อความอื่นนอก JSON

    ข้อบังคับสำคัญ:
    - ทุก stop ต้องเลือกจากข้อมูลสถานที่ในฐานข้อมูลด้านล่างเท่านั้น
    - ห้ามเพิ่มชื่อสถานที่จากความรู้ของโมเดล ห้ามเดาสถานที่ และห้ามสร้าง URL รูปภาพเอง
    - ต้องคัดลอก destinationId, ชื่อ, พิกัด และ imageUrl จากข้อมูลฐานข้อมูลตรงตัว
    - ถ้าข้อมูลมีน้อย ให้สร้างแผนจากรายการที่มีเท่านั้น ห้ามเติมสถานที่อื่นให้ครบจำนวนวัน
    - จัดกลุ่มสถานที่บนเกาะและบนฝั่งเป็นช่วงเดียวกัน ห้ามวางลำดับ เกาะ → ฝั่ง → เกาะ หรือ ฝั่ง → เกาะ → ฝั่ง ในวันเดียวกัน ไม่ว่าจะใช้พาหนะชนิดใด
    - ในหนึ่งวันให้ข้ามระหว่างเกาะกับฝั่งได้ไม่เกินหนึ่งครั้ง ไม่ว่าจะใช้พาหนะชนิดใด (car/bus/train/ferry/flight/walking) เว้นแต่จำเป็นต่อสถานที่ที่ผู้ใช้บังคับเลือก

    ข้อมูลสถานที่จากฐานข้อมูล:
    ${placesContext}`;

    const userPrompt =
        `สร้างแผนเที่ยว ${tripInput.days} วัน โดยเริ่มจาก GPS ${tripInput.start_latitude}, ${tripInput.start_longitude}

    ข้อมูลผู้เดินทาง:
    - งบประมาณ: ${tripInput.budget} ${tripInput.currency || 'THB'}
    - สไตล์การท่องเที่ยว: ${tripInput.travel_style || 'ไม่ระบุ'}
    - ประเภทกลุ่ม: ${tripInput.group_type || 'ไม่ระบุ'}
    - ความสนใจ: ${(tripInput.interests || []).join(', ') || 'ไม่ระบุ'}
    - พื้นที่/จังหวัด (ถ้ามี): ${tripInput.destination || 'ให้เลือกจากตำแหน่ง GPS'}
    - วิธีเดินทางที่ยอมรับ: ${allowedTransportModes.join(', ')}
    - สถานที่ที่ผู้ใช้บังคับเลือก: ${mustVisitDescription}
    - สถานที่ที่ผู้ใช้ลบและห้ามเสนอซ้ำ: ${(tripInput.excluded_places || []).join(', ') || 'ไม่มี'}

    สถานที่ที่ผู้ใช้บังคับเลือกทั้งหมดต้องอยู่ใน stops ของทริปอย่างน้อย 1 ครั้ง และมีความสำคัญเหนือความสนใจ วิธีเดินทาง งบประมาณ และรายการที่ลบซ้ำถ้าขัดกัน
    เลือกสถานที่อื่นจากฐานข้อมูลเท่านั้น ให้เหมาะกับความสนใจและงบประมาณ จัดลำดับจากจุดเริ่ม GPS เพื่อลดการย้อนเส้นทาง
    ห้ามเสนอหรือสร้าง stop ที่ไม่มีอยู่ในข้อมูลสถานที่จากฐานข้อมูล แม้จำนวนสถานที่จะไม่พอกับจำนวนวัน
    transportMode ของแต่ละ stop หมายถึงพาหนะหลักที่ใช้เดินทางมาจาก stop ก่อนหน้า และต้องเลือกจากวิธีเดินทางที่ผู้ใช้ยอมรับเท่านั้น
    ถ้าวิธีเดินทางที่ผู้ใช้เลือกไม่เหมาะกับสถานที่บังคับเลือก ให้ยังคงใส่สถานที่นั้นในแผนและระบุใน tip ให้ตรวจสอบวิธีเดินทางจริง
    แต่ละ stop เลือก transportMode ต่างกันได้ตามความเหมาะสม ห้ามใช้รถยนต์หรือเดินข้ามทะเล
    ถ้าเป็นเครื่องบิน รถไฟ หรือเรือ ให้ใส่ segments แยกช่วงไปสถานี/สนามบิน/ท่าเรือ ช่วงขนส่งหลัก และช่วงต่อไปยังจุดหมาย โดยใช้ชื่อจุดเชื่อมต่อจริงที่มั่นใจเท่านั้น
    ใช้ flight สำหรับระยะไกลที่ต้องบิน, ferry สำหรับการข้ามเกาะ/ทะเล, train สำหรับเส้นทางรถไฟ, bus หรือ car สำหรับถนน และ walking เฉพาะระยะที่เดินได้จริง
    ห้ามแต่งหมายเลขเที่ยวบิน รอบเรือ รอบรถไฟ หรือเวลาออกเดินทางจริง หากไม่มีข้อมูลตารางเวลา ให้ระบุใน tip ว่าเป็นเวลาโดยประมาณและควรตรวจสอบตารางกับผู้ให้บริการ
    ถ้าผู้ใช้อนุญาตวิธีเดินทางระยะไกลและไม่ได้จำกัดจังหวัด สามารถวางแผนหลายจังหวัดได้เมื่อจำนวนวันและงบประมาณเหมาะสม แต่ไม่จำเป็นต้องฝืนเดินทางไกล
    ค่าใช้จ่ายทั้งหมดเป็นค่าประมาณต่อทริป และทุก stop ต้องมี latitude/longitude ที่ใช้งานบนแผนที่ได้

    ตอบในรูปแบบ JSON นี้เท่านั้น:
    {
    "summary": "สรุปแผนเที่ยว 2-3 ประโยค",
    "totalEstimatedCost": 0,
    "budgetBreakdown": {
        "accommodation": 0,
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
    "tips": ["เคล็ดลับการเดินทาง 1", "เคล็ดลับ 2"]
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
                    throw new SyntaxError('Gemini returned no complete JSON object');
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
                        `Gemini plan JSON is missing days (keys=${Object.keys(planData).join(',')})`,
                    );
                }
                normalizePlanTransportModes(planData, allowedTransportModes);
                normalizePlanPlaces(planData, places);
                ensureMustVisitStops(planData, mustVisitPlaces, {
                    allowedTransportModes,
                    days: tripInput.days,
                });
                normalizePlanTransportModes(planData, allowedTransportModes);
                normalizePlanPlaces(planData, places);
                const ferryViolations = findExcessIslandCrossings(
                    planData,
                    mustVisitPlaces,
                    places,
                );
                if (ferryViolations.length > 0) {
                    if (generationAttempt === 0) {
                        routeCorrection = `\n\nการตรวจแผนพบการข้ามเกาะ/ฝั่งซ้ำ: ${formatIslandViolations(ferryViolations)}\nกรุณาสร้างแผนใหม่โดยรวมสถานที่ฝั่งเดียวกันไว้ต่อเนื่อง และให้ข้ามระหว่างเกาะกับฝั่งไม่เกินหนึ่งครั้งต่อวันไม่ว่าจะใช้พาหนะชนิดใด (car/bus/train/ferry/flight/walking) ห้ามตัดสถานที่ที่ผู้ใช้บังคับเลือก`;
                        continue;
                    }
                    const routeError = new Error(
                        `Plan still has excessive island crossings: ${formatIslandViolations(ferryViolations)}`,
                    );
                    routeError.code = 'EXCESSIVE_FERRY_CROSSINGS';
                    throw routeError;
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
                await wait(750);
            }
        }

        // บันทึกแผนการเดินทางลง trip_plans
        await query(
            `INSERT INTO trip_plans (trip_id, plan_data, markdown_cache)
             VALUES ($1, $2, $3)`,
            [tripId, JSON.stringify(planData), fullText]
        );

        // อัปเดตสถานะการเดินทางเป็นเสร็จสิ้น
        await query(`UPDATE trips SET status = 'done' WHERE id = $1`, [tripId]);

        res.write(`data: ${JSON.stringify({ type: 'done', tripId })}\n\n`);
    } catch (err) {
        console.error('[ai] generateTripPlan error:', err.message);
        await query(`UPDATE trips SET status = 'failed' WHERE id = $1`, [tripId]);
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
    tripId,
    userMessage,
    chatHistory,
    res,
    { existingUserMessageId = null } = {},
) {
    // ดึง trip context
    const { rows: tripRows } = await query(
        'SELECT destination, province, interests FROM trips WHERE id = $1',
        [tripId]
    );
    const trip = tripRows[0];

    // ตรวจสอบว่าเป็นคำถามเกี่ยวกับการท่องเที่ยวหรือไม่
    const isTravelQuery = isTravelRelatedQuery(userMessage);
    
    let places = [];
    let placesContext = '';
    let sourceChunkIds = [];
    
    // ใช้ RAG เฉพาะเมื่อเป็นคำถามเกี่ยวกับการท่องเที่ยว
    if (isTravelQuery) {
        // RAG: embed คำถาม → ดึง relevant places
        places = await retrieveRelevantPlaces(userMessage, {
            province: trip?.province,
            limit: 5,
        });

        placesContext = formatPlacesContext(places);
        sourceChunkIds = places.map(p => p.id);
    }

    // เปิด Google Search เฉพาะเมื่อ RAG ไม่ได้ข้อมูลจากฐานข้อมูลเลย
    // เพราะ grounding มีโควตาแยกของตัวเองและ free tier มักไม่รองรับ
    const useWebSearch = isTravelQuery && places.length === 0;

    const travelGuideRules = `คุณคือ AI Guide สำหรับการท่องเที่ยวและวัฒนธรรมไทย
    ตอบเป็นภาษาเดียวกับข้อความล่าสุดของผู้ใช้ และใช้ภาษาอังกฤษเป็นค่าเริ่มต้นเมื่อระบุภาษาไม่ได้
    ตอบคำถามเกี่ยวกับการท่องเที่ยว สถานที่ ป้ายภาษาไทย อาหารไทย และผลการสแกนก่อนหน้า
    ใช้ chat history เมื่อตอบคำถามต่อเนื่องเกี่ยวกับรูปที่เพิ่งสแกน แต่ต้องคงระดับความไม่แน่นอนจากผลเดิม
    ห้ามยืนยันสารก่อภูมิแพ้ ส่วนผสมทั้งหมด หรือสถานะฮาลาลจากภาพอาหารเพียงอย่างเดียว
    ห้ามใช้ markdown formatting เช่น **, *, #, -, หรือสัญลักษณ์อื่นๆ ในคำตอบ ตอบเป็นข้อความธรรมดาเท่านั้น`;

    const systemPrompt = isTravelQuery ?
    (useWebSearch ?
    `${travelGuideRules}
    ไม่พบข้อมูลสถานที่ที่เกี่ยวข้องในฐานข้อมูลของแอป ให้ค้นหาข้อมูลจาก Google Search เพื่อช่วยตอบคำถาม
    สรุปจากผลค้นหาอย่างระมัดระวัง และระบุให้ผู้ใช้ทราบว่าข้อมูลนี้มาจากเว็บ ไม่ใช่สถานที่ที่ยืนยันในฐานข้อมูลของแอป
    ถ้าผลค้นหาไม่ชัดเจนหรือขัดแย้งกัน ให้แจ้งข้อจำกัดนั้นแทนการเดา` :
    `${travelGuideRules}
    สำหรับข้อมูลสถานที่ ให้ยึด context จากฐานข้อมูลเป็นหลัก ถ้าข้อมูลไม่อยู่ใน context ให้บอกตรงๆ ว่าไม่มีข้อมูลยืนยัน
    หากมีข้อมูลบางส่วนหรือสถานที่ย่อยที่เกี่ยวข้องกันในพื้นที่ ให้แจ้งข้อมูลนั้นโดยตรงทันที

    ข้อมูลสถานที่ที่เกี่ยวข้อง:
    ${placesContext}`) :
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

        // เก็บแหล่งอ้างอิงเว็บจาก grounding metadata เพื่อแนบท้ายคำตอบ
        const groundingChunks = [];
        const collectGrounding = (chunks) => groundingChunks.push(...chunks);

        try {
            for await (const token of streamGemini(systemPrompt, messages, 1024, {
                googleSearch: useWebSearch,
                onGrounding: useWebSearch ? collectGrounding : null,
            })) {
                fullAnswer += token;
                res.write(`data: ${JSON.stringify({ type: 'token', text: token })}\n\n`);
            }
        } catch (searchError) {
            // grounding ล้มเหลว (เช่น 429 เกินโควตา search) และยังไม่ได้ส่งคำตอบส่วนไหนออกไป
            // ให้ stream ซ้ำแบบไม่มี grounding เพื่อไม่ให้แชทล่ม
            if (!useWebSearch || fullAnswer) throw searchError;
            console.warn(`[ai] Google Search grounding failed: ${searchError.message}; retrying without grounding`);
            groundingChunks.length = 0;
            const fallbackPrompt = `${travelGuideRules}
    ไม่พบข้อมูลสถานที่ที่เกี่ยวข้องในฐานข้อมูล ให้บอกผู้ใช้ตรงๆ ว่ายังไม่มีข้อมูลยืนยันสำหรับคำถามนี้`;
            for await (const token of streamGemini(fallbackPrompt, messages, 1024)) {
                fullAnswer += token;
                res.write(`data: ${JSON.stringify({ type: 'token', text: token })}\n\n`);
            }
        }

        // ส่ง citation เป็น token สุดท้ายเพื่อให้ผู้ใช้เห็นในแชทและบันทึกลงประวัติด้วย
        const webCitations = formatWebCitations(groundingChunks, userMessage);
        if (webCitations) {
            fullAnswer += `\n\n${webCitations}`;
            res.write(
                `data: ${JSON.stringify({ type: 'token', text: `\n\n${webCitations}` })}\n\n`,
            );
        }

        let userMessageId;
        let assistantMessageId;
        let deletedAssistantMessageIds = [];

        if (existingUserMessageId) {
            // อัปเดต prompt, ลบคำตอบเดิม และเพิ่มคำตอบใหม่ใน statement เดียว
            // จึงไม่ทิ้งบทสนทนาไว้ครึ่งทางหากบันทึกฐานข้อมูลล้มเหลว
            const { rows } = await query(
                `WITH updated_user AS (
                    UPDATE chat_messages
                    SET content = $2, edited_at = NOW()
                    WHERE id = $5
                      AND session_id = $1
                      AND role = 'user'
                      AND image_path IS NULL
                    RETURNING id, created_at
                 ), deleted_assistants AS (
                    DELETE FROM chat_messages
                    WHERE session_id = $1
                      AND role = 'assistant'
                      AND reply_to_message_id IN (SELECT id FROM updated_user)
                    RETURNING id
                 ), new_assistant AS (
                    INSERT INTO chat_messages (
                        session_id, role, content, source_chunk_ids,
                        reply_to_message_id, created_at
                    )
                    SELECT $1, 'assistant', $3, $4, id, created_at
                    FROM updated_user
                    RETURNING id, reply_to_message_id
                 )
                 SELECT new_assistant.id AS assistant_message_id,
                        new_assistant.reply_to_message_id AS user_message_id,
                        COALESCE(
                            (SELECT array_agg(id) FROM deleted_assistants),
                            '{}'::int[]
                        ) AS deleted_assistant_message_ids
                 FROM new_assistant`,
                [sessionId, userMessage, fullAnswer, sourceChunkIds, existingUserMessageId],
            );
            if (!rows[0]) throw new Error('Editable chat message no longer exists');
            userMessageId = rows[0].user_message_id;
            assistantMessageId = rows[0].assistant_message_id;
            deletedAssistantMessageIds = rows[0].deleted_assistant_message_ids || [];
        } else {
            const { rows } = await query(
                `WITH new_user AS (
                    INSERT INTO chat_messages (
                        session_id, role, content, source_chunk_ids
                    )
                    VALUES ($1, 'user', $2, '{}')
                    RETURNING id
                 ), new_assistant AS (
                    INSERT INTO chat_messages (
                        session_id, role, content, source_chunk_ids,
                        reply_to_message_id
                    )
                    SELECT $1, 'assistant', $3, $4, id
                    FROM new_user
                    RETURNING id, reply_to_message_id
                 )
                 SELECT new_user.id AS user_message_id,
                        new_assistant.id AS assistant_message_id
                 FROM new_user
                 JOIN new_assistant
                   ON new_assistant.reply_to_message_id = new_user.id`,
                [sessionId, userMessage, fullAnswer, sourceChunkIds],
            );
            if (!rows[0]) throw new Error('Chat messages could not be saved');
            userMessageId = rows[0].user_message_id;
            assistantMessageId = rows[0].assistant_message_id;
        }

        const sources = places.map(place => ({
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
