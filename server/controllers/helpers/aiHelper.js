// server/controllers/helpers/aiHelper.js

const pool = require('../../config/db');
const query = pool.query.bind(pool);
const { jsonrepair } = require('jsonrepair');
const { retrieveRelevantPlaces, retrieveNearbyPlaces, formatPlacesContext } = require('./ragHelper');
const { config } = require('../../config/env');
const GEMINI_API_KEY = config.gemini.apiKey;
const GEMINI_API_BASE = config.gemini.apiBaseUrl;
const GEMINI_MODEL = config.gemini.model;
const GEMINI_MAX_RETRIES = config.gemini.maxRetries;
const GEMINI_PLAN_THINKING_BUDGET = config.gemini.planThinkingBudget;
const SUPPORTED_TRANSPORT_MODES = new Set(['car', 'walking']);
const GEMINI_HEADERS = {
    'Content-Type': 'application/json',
    // ส่ง key ใน header เพื่อไม่ให้ค่าลับติด URL หรือ access log
    'x-goog-api-key': GEMINI_API_KEY,
};

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const getAllowedTransportModes = (modes) => {
    const allowed = Array.isArray(modes)
        ? modes
            .map((mode) => String(mode).trim().toLowerCase())
            .filter((mode) => SUPPORTED_TRANSPORT_MODES.has(mode))
        : [];
    return allowed.length > 0 ? [...new Set(allowed)] : ['car'];
};

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
                            required: ['place', 'activity', 'latitude', 'longitude', 'arrivalTime', 'durationMinutes', 'entryCost', 'foodCost', 'transportMode', 'transportCost'],
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
async function* streamGemini(systemPrompt, messages, maxTokens = 4096, jsonMode = false) {

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
                const text = event.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) {
                    yield text;
                }
            } catch {
                // ข้ามเฉพาะ SSE event ที่ถูกตัดกลางทาง แล้วอ่าน event ถัดไปต่อ
            }
        }
    }
}

// แผนเที่ยวขอเป็น response เดียวเพื่อไม่ต้องต่อ JSON ที่ถูกแบ่งเป็น SSE หลายชิ้น
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
            thinkingConfig: {
                thinkingBudget: GEMINI_PLAN_THINKING_BUDGET,
            },
        },
    };

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
async function generateTripPlan(tripId, tripInput, res) {
    const allowedTransportModes = getAllowedTransportModes(tripInput.transport_modes);

    // ดึง relevant places จาก RAG
    const ragQuery = [
        tripInput.destination || 'สถานที่ท่องเที่ยวใกล้ฉัน',
        ...(tripInput.interests || []),
        tripInput.travel_style || '',
    ].join(' ');

    let places;
    if (tripInput.start_latitude != null && tripInput.start_longitude != null) {
        places = await retrieveNearbyPlaces(
            tripInput.start_latitude,
            tripInput.start_longitude,
            15,
        );
    } else {
        places = await retrieveRelevantPlaces(ragQuery, {
            province: tripInput.province || null,
            limit: 15,
        });
    }

    const placesContext = formatPlacesContext(places);

    const systemPrompt =
        `คุณคือผู้เชี่ยวชาญวางแผนการท่องเที่ยวในประเทศไทย
    ตอบเป็นภาษาไทยเสมอ และตอบในรูปแบบ JSON ที่กำหนดเท่านั้น ห้ามมีข้อความอื่นนอก JSON

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
    - สถานที่ที่ผู้ใช้บังคับเลือก: ${(tripInput.must_visit || []).map(p => p.name || p).join(', ') || 'ไม่มี'}
    - สถานที่ที่ผู้ใช้ลบและห้ามเสนอซ้ำ: ${(tripInput.excluded_places || []).join(', ') || 'ไม่มี'}

    เลือกสถานที่จากฐานข้อมูลเท่านั้น ให้เหมาะกับความสนใจและงบประมาณ จัดลำดับจากจุดเริ่ม GPS เพื่อลดการย้อนเส้นทาง
    ถ้าเป็นเครื่องบิน รถไฟ หรือเรือ ให้แยกช่วงไปสถานี/สนามบิน/ท่าเรือ ช่วงขนส่งหลัก และช่วงต่อไปยังจุดหมาย
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
        let fullText = '';
        let planData;

        for (let generationAttempt = 0; generationAttempt < 2; generationAttempt++) {
            const generated = await generateGeminiJson(systemPrompt, userPrompt);
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

        // save trip_plans
        await query(
            `INSERT INTO trip_plans (trip_id, plan_data, markdown_cache)
             VALUES ($1, $2, $3)`,
            [tripId, JSON.stringify(planData), fullText]
        );

        // update trip status → done
        await query(`UPDATE trips SET status = 'done' WHERE id = $1`, [tripId]);

        res.write(`data: ${JSON.stringify({ type: 'done', tripId })}\n\n`);
    } catch (err) {
        console.error('[ai] generateTripPlan error:', err.message);
        await query(`UPDATE trips SET status = 'failed' WHERE id = $1`, [tripId]);
        const transient = err instanceof SyntaxError || err.statusCode === 429 || err.statusCode >= 500;
        const message = transient
            ? 'The AI travel planner is temporarily busy. Please try again in a moment.'
            : 'The travel plan could not be generated. Please review your details and try again.';
        res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
    } finally {
        res.end();
    }
}

// ragChat()
// ตอบคำถามเกี่ยวกับแผนเที่ยว ด้วย RAG + chat history
// ส่งกลับไป Flutter พร้อมบันทึก source_chunk_ids
async function ragChat(sessionId, tripId, userMessage, chatHistory, res) {
    // ดึง trip context
    const { rows: tripRows } = await query(
        'SELECT destination, province, interests FROM trips WHERE id = $1',
        [tripId]
    );
    const trip = tripRows[0];

    // RAG: embed คำถาม → ดึง relevant places
    const places = await retrieveRelevantPlaces(userMessage, {
        province: trip?.province,
        limit: 5,
    });

    const placesContext = formatPlacesContext(places);
    const sourceChunkIds = places.map(p => p.id);

    const systemPrompt =
    `คุณคือ AI Guide สำหรับการท่องเที่ยวและวัฒนธรรมไทย
    ตอบเป็นภาษาเดียวกับข้อความล่าสุดของผู้ใช้ และใช้ภาษาอังกฤษเป็นค่าเริ่มต้นเมื่อระบุภาษาไม่ได้
    ตอบคำถามเกี่ยวกับการท่องเที่ยว สถานที่ ป้ายภาษาไทย อาหารไทย และผลการสแกนก่อนหน้า
    ใช้ chat history เมื่อตอบคำถามต่อเนื่องเกี่ยวกับรูปที่เพิ่งสแกน แต่ต้องคงระดับความไม่แน่นอนจากผลเดิม
    สำหรับข้อมูลสถานที่ ให้ยึด context จากฐานข้อมูลเป็นหลัก ถ้าข้อมูลไม่อยู่ใน context ให้บอกตรงๆ ว่าไม่มีข้อมูลยืนยัน
    ห้ามยืนยันสารก่อภูมิแพ้ ส่วนผสมทั้งหมด หรือสถานะฮาลาลจากภาพอาหารเพียงอย่างเดียว
    หากมีข้อมูลบางส่วนหรือสถานที่ย่อยที่เกี่ยวข้องกันในพื้นที่ ให้แจ้งข้อมูลนั้นโดยตรงทันที

    ข้อมูลสถานที่ที่เกี่ยวข้อง:
    ${placesContext}`;

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

        for await (const token of streamGemini(systemPrompt, messages, 1024)) {
            fullAnswer += token;
            res.write(`data: ${JSON.stringify({ type: 'token', text: token })}\n\n`);
        }

        // บันทึก user message + assistant answer
        await query(
            `INSERT INTO chat_messages (session_id, role, content, source_chunk_ids)
             VALUES ($1, 'user', $2, '{}'), ($1, 'assistant', $3, $4)`,
            [sessionId, userMessage, fullAnswer, sourceChunkIds]
        );

        const sources = places.map(place => ({
            id: place.id,
            name: place.name,
            province: place.province,
            category: place.category,
            image_url: place.image_url,
        }));
        res.write(`data: ${JSON.stringify({ type: 'done', sourceChunkIds, sources })}\n\n`);
    } catch (err) {
        console.error('[ai] ragChat error:', err.message);
        res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    } finally {
        res.end();
    }
}

module.exports = { generateTripPlan, ragChat };
