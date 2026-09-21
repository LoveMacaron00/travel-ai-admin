// server/services/aiProvider.js
// Client กลางสำหรับ 9router (OpenAI-compatible gateway: POST /v1/chat/completions, /v1/embeddings)
// เดิมโค้ดเรียก Gemini native (generativelanguage.googleapis.com + x-goog-api-key)
// ตอนนี้ทุก service (แชท/แผน/รูป/embedding) วิ่งผ่านไฟล์นี้ไฟล์เดียว เปลี่ยน base URL/key/model ใน .env ได้เลย

const { config } = require('../config/env');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getBaseUrl = () => String(config.gemini.apiBaseUrl || 'http://localhost:20128/v1').replace(/\/+$/, '');
const getApiKey = () => config.gemini.apiKey;
// รองรับ model สำรองหลายตัวคั่นด้วย comma: "model-a,model-b,model-c"
// ถ้าตัวหลักโควต้าหมด (429) หาโมเดลไม่เจอ (404) หรือล่ม (5xx) จะสลับไปตัวถัดไปอัตโนมัติ
const parseModelList = (value, fallback) => [...new Set(
    String(value || fallback || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
)];
const getModelList = () => parseModelList(config.gemini.model, 'gemini/gemini-3.6-flash');
const getEmbeddingModelList = () => parseModelList(config.gemini.embeddingModel, 'gemini-embedding-001');
const getModel = () => getModelList()[0];
const getEmbeddingModel = () => getEmbeddingModelList()[0];
const getMaxRetries = () => config.gemini.maxRetries;
const getEmbeddingDimensions = () => config.gemini.embeddingDimensions || 1536;

const authHeaders = () => {
    const key = getApiKey();
    if (!key) throw new Error('ไม่ได้ตั้งค่า AI API key ในระบบ (.env: AI_API_KEY หรือ GEMINI_API_KEY)');
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
    };
};

// สถานะที่ควรสลับไปโมเดลถัดไปแทนการฝืนยิงโมเดลเดิมซ้ำ:
// 429 (โควต้าหมด — รอไปก็ไม่หายในเวลาสั้น), 404 (ไม่มีโมเดลนี้), 408/5xx (ล่ม)
// ส่วน 400/401/403 คือ request/config ผิด ลองโมเดลอื่นก็ไม่หาย จึง throw ทันที
const shouldTryNextModel = (status) => status === 404 || status === 408 || status === 429 || status >= 500;

// ส่ง POST ไป 9router โดยไล่โมเดลสำรองตามลำดับ คืน { response, model } ของตัวที่สำเร็จ
// โมเดลเดียวพฤติกรรมเหมือนเดิมทุกอย่าง (retry เท่า GEMINI_MAX_RETRIES)
// หลายโมเดลจะ failover เร็ว: 429/404 สลับทันทีไม่รอ, 5xx/408 retry โมเดลเดิม 1 ครั้งก่อนสลับ
async function postToRouter(path, buildBody, models) {
    const url = `${getBaseUrl()}${path}`;
    const headers = authHeaders();
    const sameModelRetries = models.length > 1 ? Math.min(getMaxRetries(), 1) : getMaxRetries();
    let lastError = new Error('No AI model configured (.env: GEMINI_MODEL)');
    for (const model of models) {
        for (let attempt = 0; attempt <= sameModelRetries; attempt++) {
            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(buildBody(model)),
            });
            if (response.ok) return { response, model };
            const errorBody = await response.text();
            lastError = new Error(`AI API error (model=${model}): ${response.status} — ${errorBody}`);
            lastError.statusCode = response.status;
            if (!shouldTryNextModel(response.status)) throw lastError;
            // 429/404 สลับโมเดลทันที — ไม่ต้องรอเพราะไม่ใช่ปัญหาชั่วคราวของโมเดลนี้
            if (response.status === 429 || response.status === 404 || attempt === sameModelRetries) {
                console.warn(`[ai] 9router model ${model} ใช้ไม่ได้ (${response.status}); สลับโมเดลถัดไป`);
                break;
            }
            const delay = 1000 * (2 ** attempt) + Math.floor(Math.random() * 500);
            console.warn(`[ai] 9router model ${model} ${response.status}; retry ${attempt + 1}/${sameModelRetries} in ${delay}ms`);
            await wait(delay);
        }
    }
    throw lastError;
}

// แปลง history ของแอป (role: user/assistant/system) ให้เป็น OpenAI messages
const toOpenAiMessages = (systemPrompt, messages) => {
    const out = [];
    if (systemPrompt) out.push({ role: 'system', content: systemPrompt });
    for (const m of messages || []) {
        const role = m.role === 'assistant' || m.role === 'system' ? m.role : 'user';
        out.push({ role, content: String(m.content ?? '') });
    }
    return out;
};

// สร้าง message แบบ vision (text + รูป base64) ตามสเปก OpenAI image_url
const toVisionUserContent = (text, imageBuffer, mimeType) => {
    const content = [{ type: 'text', text: String(text || '') }];
    if (imageBuffer) {
        content.push({
            type: 'image_url',
            image_url: {
                url: `data:${mimeType || 'image/jpeg'};base64,${imageBuffer.toString('base64')}`,
            },
        });
    }
    return content;
};

// เรียกแชทแบบไม่ stream — คืน { text, finishReason, usage }
async function chatCompletion({
    systemPrompt = '',
    messages = [],
    maxTokens = 4096,
    temperature = 0.7,
    jsonMode = false,
    userContent = null, // ใช้แทน messages ข้อสุดท้ายเมื่อเป็น vision
} = {}) {
    const finalMessages = userContent
        ? [
            ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
            { role: 'user', content: userContent },
        ]
        : toOpenAiMessages(systemPrompt, messages);

    const buildBody = (model) => {
        const body = {
            model,
            messages: finalMessages,
            max_tokens: maxTokens,
            temperature,
            stream: false,
        };
        if (jsonMode) {
            // 9router รองรับ json_object; JSON schema แบบ Gemini (responseJsonSchema) ไม่รองรับจึงไม่ส่ง
            body.response_format = { type: 'json_object' };
        }
        return body;
    };

    const { response, model } = await postToRouter('/chat/completions', buildBody, getModelList());
    const payload = await response.json();
    const choice = payload.choices?.[0];
    const text = choice?.message?.content || '';
    if (!text) {
        throw new Error(
            `AI returned no content (model=${model}, finishReason=${choice?.finish_reason || 'unknown'})`,
        );
    }
    return {
        text,
        finishReason: choice?.finish_reason || 'UNKNOWN',
        usage: payload.usage || null,
    };
}

// เรียกแชทแบบ stream — yield ข้อความทีละชิ้น (OpenAI SSE: choices[0].delta.content)
async function* chatCompletionStream({
    systemPrompt = '',
    messages = [],
    maxTokens = 4096,
    temperature = 0.7,
    jsonMode = false,
} = {}) {
    const buildBody = (model) => {
        const body = {
            model,
            messages: toOpenAiMessages(systemPrompt, messages),
            max_tokens: maxTokens,
            temperature,
            stream: true,
        };
        if (jsonMode) body.response_format = { type: 'json_object' };
        return body;
    };

    // fallback เกิดตอนเปิด connection เท่านั้น — ถ้า stream ขาดกลางคันจะไม่เริ่มโมเดลใหม่
    // (เพื่อไม่ให้ข้อความซ้ำ) แล้วให้ caller ตัดสินใจ retry ทั้งเทิร์นเอง
    const { response } = await postToRouter('/chat/completions', buildBody, getModelList());

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            try {
                const event = JSON.parse(data);
                const delta = event.choices?.[0]?.delta?.content;
                if (delta) yield delta;
            } catch {
                // ข้าม SSE event ที่ถูกตัดกลางทาง แล้วอ่าน event ถัดไปต่อ
            }
        }
    }
}

// ขอ embedding ผ่าน 9router — คืนเวกเตอร์ยาวเท่าขนาดใน DB (ตัด prefix แบบ Matryoshka ถ้า provider คืนมายาวกว่า)
async function getEmbeddingVector(text) {
    const buildBody = (model) => ({ model, input: String(text || '') });
    const { response } = await postToRouter('/embeddings', buildBody, getEmbeddingModelList());
    const data = await response.json();
    const values = data.data?.[0]?.embedding;
    if (!Array.isArray(values) || values.length === 0) {
        throw new Error('AI embedding returned no vector');
    }
    const target = getEmbeddingDimensions();
    if (values.length === target) return values;
    if (values.length > target) {
        // gemini-embedding-001 เป็น Matryoshka: ตัดเหลือ prefix เท่าขนาดคอลัมน์ vector(1536) เดิม
        // จึงเทียบกับเวกเตอร์เก่าใน DB ได้โดยไม่ต้อง migrate
        return values.slice(0, target);
    }
    throw new Error(`AI embedding returned invalid vector size: ${values.length} (expected ${target})`);
}

module.exports = {
    chatCompletion,
    chatCompletionStream,
    getEmbeddingVector,
    toVisionUserContent,
    getBaseUrl,
    getModel,
    getModelList,
    getEmbeddingModel,
    getEmbeddingModelList,
};
