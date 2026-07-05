// aiHelper.js — Gemini API plan generation + RAG chat
//   generateTripPlan() สร้างแผนเที่ยว → Flutter
//   ragChat() ตอบคำถามด้วย RAG context → Flutter

const pool = require('../../config/db');
const query = pool.query.bind(pool);
const { retrieveRelevantPlaces, formatPlacesContext } = require('./ragHelper');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash';

// streamGemini()
// คืน async generator ที่ yield ทีละ text delta
async function* streamGemini(systemPrompt, messages, maxTokens = 4096) {

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

    if (systemPrompt) {
        body.systemInstruction = {
            parts: [{ text: systemPrompt }]
        };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Gemini API error: ${response.status} — ${err}`);
    }

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = '';

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
            } catch {}
        }
    }
}

// generateTripPlan()
// สร้างแผนเที่ยว พร้อม ส่งกลับไป Flutter
// หลังส่งเสร็จ → save trip_plans + embed plan chunks
async function generateTripPlan(tripId, tripInput, res) {
    // ดึง relevant places จาก RAG
    const ragQuery = [
        tripInput.destination,
        ...(tripInput.interests || []),
        tripInput.travel_style || '',
    ].join(' ');

    const places = await retrieveRelevantPlaces(ragQuery, {
        province : tripInput.province,
        limit : 15,
    });

    const placesContext = formatPlacesContext(places);

    const systemPrompt = 
    `คุณคือผู้เชี่ยวชาญวางแผนการท่องเที่ยวในประเทศไทย
    ตอบเป็นภาษาไทยเสมอ และตอบในรูปแบบ JSON ที่กำหนดเท่านั้น ห้ามมีข้อความอื่นนอก JSON

    ข้อมูลสถานที่จากฐานข้อมูล:
    ${placesContext}`;

    const userPrompt = 
    `สร้างแผนเที่ยว ${tripInput.days} วัน ที่ ${tripInput.destination}

    ข้อมูลผู้เดินทาง:
    - งบประมาณ: ${tripInput.budget} ${tripInput.currency || 'THB'}
    - สไตล์การท่องเที่ยว: ${tripInput.travel_style || 'ไม่ระบุ'}
    - ประเภทกลุ่ม: ${tripInput.group_type || 'ไม่ระบุ'}
    - ความสนใจ: ${(tripInput.interests || []).join(', ') || 'ไม่ระบุ'}

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
        "morning":   { "activity": "", "place": "", "cost": 0, "duration": "", "tip": "" },
        "afternoon": { "activity": "", "place": "", "cost": 0, "duration": "", "tip": "" },
        "evening":   { "activity": "", "place": "", "cost": 0, "duration": "", "tip": "" }
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

    let fullText = '';

    try {
        for await (const token of streamGemini(systemPrompt, [{ role: 'user', content: userPrompt }])) {
            fullText += token;
            res.write(`data: ${JSON.stringify({ type: 'token', text: token })}\n\n`);
        }

        // parse JSON จาก Claude
        const cleanJson = fullText.replace(/```json|```/g, '').trim();
        const planData  = JSON.parse(cleanJson);

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
        res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
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
        province : trip?.province,
        limit    : 5,
    });

    const placesContext  = formatPlacesContext(places);
    const sourceChunkIds = places.map(p => p.id);

    const systemPrompt =
    `คุณคือ AI ผู้ช่วยวางแผนการท่องเที่ยวในประเทศไทย ตอบเป็นภาษาไทย
    ตอบเฉพาะคำถามที่เกี่ยวกับการท่องเที่ยว สถานที่ และแผนเดินทาง
    ถ้าข้อมูลไม่อยู่ใน context ให้บอกตรงๆ ว่าไม่มีข้อมูล
    หากมีข้อมูลบางส่วนหรือสถานที่ย่อยที่เกี่ยวข้องกันในพื้นที่ (เช่น พิพิธภัณฑ์/กิจกรรมในบริเวณหาด) ให้แจ้งข้อมูลนั้นโดยตรงทันที ไม่ต้องปฏิเสธก่อนว่าไม่มีข้อมูลของอีกส่วนหนึ่ง

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

        res.write(`data: ${JSON.stringify({ type: 'done', sourceChunkIds })}\n\n`);
    } catch (err) {
        console.error('[ai] ragChat error:', err.message);
        res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    } finally {
        res.end();
    }
}

async function mobileRagChat(userMessage, options = {}) {
    const places = await retrieveRelevantPlaces(userMessage, {
        province : options.province || null,
        limit    : options.limit || 5,
    });

    const placesContext = formatPlacesContext(places);
    const systemPrompt =
    `คุณคือ AI Chatbot ผู้ช่วยท่องเที่ยวในประเทศไทย ตอบเป็นภาษาไทย กระชับ และอ้างอิงข้อมูลจาก RAG context ก่อนเสมอ
    ใช้ข้อมูลเวลาเปิด-ปิด ค่าเข้าชม เบอร์ติดต่อ รายละเอียด และเกร็ดจาก TAT ถ้ามี
    ถ้าข้อมูลสำคัญไม่มีใน context ให้บอกตรงๆ ว่ายังไม่มีข้อมูลยืนยัน และแนะนำให้ตรวจสอบกับสถานที่ก่อนเดินทาง
    หากมีข้อมูลบางส่วนหรือสถานที่ย่อยที่เกี่ยวข้องกันในพื้นที่ (เช่น พิพิธภัณฑ์/กิจกรรมในบริเวณหาด) ให้แจ้งข้อมูลนั้นโดยตรงทันที ไม่ต้องปฏิเสธก่อนว่าไม่มีข้อมูลของอีกส่วนหนึ่ง

    ข้อมูลสถานที่ที่เกี่ยวข้อง:
    ${placesContext}`;

    const messages = [{ role: 'user', content: userMessage }];
    let answer = '';

    for await (const token of streamGemini(systemPrompt, messages, 1024)) {
        answer += token;
    }

    return {
        answer,
        sources: places.map((place) => ({
            id: place.id,
            name: place.name,
            province: place.province,
            category: place.category,
            image_url: place.image_url,
        })),
    };
}

module.exports = { generateTripPlan, ragChat, mobileRagChat };
