const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// แปลงค่าตัวแปรสภาพแวดล้อมเป็นตัวเลข หรือคืนค่าทดแทนหากค่าไม่ถูกต้อง
const asNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

// ตัด slash ท้าย URL เพื่อให้ต่อ path เพิ่มได้โดยไม่เกิด //
const withoutTrailingSlash = (value) => value.replace(/\/+$/, '');

// แปลงค่า boolean จาก env ('true'/'1'/'yes' เท่านั้นที่ถือว่าเปิด)
const asBoolean = (value, fallback) => {
    if (value === undefined || value === null || value === '') return fallback;
    return ['true', '1', 'yes', 'y', 'on'].includes(String(value).trim().toLowerCase());
};

// อ่าน process.env เพียงไฟล์เดียว เพื่อให้ชื่อ ค่า default และการแปลง type
// ไม่กระจายอยู่ตาม controller รวมถึงช่วยให้ตรวจ config ตอนเริ่มระบบได้
const config = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: asNumber(process.env.PORT, 5000),
    allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:5173')
        .split(',')
        .map((origin) => withoutTrailingSlash(origin.trim()))
        .filter(Boolean),
    database: {
        host: process.env.DB_HOST || 'localhost',
        port: asNumber(process.env.DB_PORT, 5432),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASS,
        name: process.env.DB_NAME || 'smarttravel',
    },
    analytics: {
        timeZone: process.env.ANALYTICS_TIME_ZONE || 'Asia/Bangkok',
    },
    mediaProxy: {
        allowedHosts: (
            process.env.MEDIA_PROXY_HOSTS
            || 'dmc.tatdataapi.io,cdn.pixabay.com,images.unsplash.com'
        )
            .split(',')
            .map((host) => host.trim().toLowerCase())
            .filter(Boolean),
        timeoutMs: Math.max(1000, asNumber(process.env.MEDIA_PROXY_TIMEOUT_MS, 10000)),
        maxBytes: Math.max(1024, asNumber(process.env.MEDIA_PROXY_MAX_BYTES, 12 * 1024 * 1024)),
    },
    jwt: {
        adminSecret: process.env.ADMIN_JWT_SECRET,
        userSecret: process.env.USER_JWT_SECRET,
    },
    gemini: {
        // รองรับ 9router (OpenAI-compatible gateway) ผ่านชื่อเดิม GEMINI_* เพื่อไม่ต้องแก้โค้ดที่เรียกใช้
        // ตั้งค่าใหม่แนะนำ: AI_API_BASE_URL / AI_API_KEY / AI_MODEL / AI_EMBEDDING_MODEL
        // แต่ถ้ามี GEMINI_* อยู่จะใช้ค่านั้นก่อน (backward compatible)
        apiKey:
            process.env.AI_API_KEY
            || process.env.NINEROUTER_API_KEY
            || process.env.GEMINI_API_KEY,
        apiBaseUrl: withoutTrailingSlash(
            process.env.AI_API_BASE_URL
            || process.env.NINEROUTER_API_BASE_URL
            || process.env.GEMINI_API_BASE_URL
            || 'http://localhost:20128/v1',
        ),
        model:
            process.env.AI_MODEL
            || process.env.NINEROUTER_MODEL
            || process.env.GEMINI_MODEL
            || 'gemini/gemini-3.6-flash',
        // ใส่ได้หลายโมเดลคั่นด้วย comma ("model-a,model-b") — ตัวหลักล่ม/โควต้าหมดจะสลับตัวถัดไปอัตโนมัติ
        embeddingModel:
            process.env.AI_EMBEDDING_MODEL
            || process.env.NINEROUTER_EMBEDDING_MODEL
            || process.env.GEMINI_EMBEDDING_MODEL
            || 'gemini-embedding-001',
        // ขนาดเวกเตอร์ใน DB (place_embeddings.embedding vector(1536))
        // 9router คืน 3072 dims — provider จะตัดเหลือเท่านี้ (Matryoshka prefix) ให้อัตโนมัติ
        embeddingDimensions: Math.max(
            128,
            asNumber(
                process.env.AI_EMBEDDING_DIMENSIONS
                || process.env.GEMINI_EMBEDDING_DIMENSIONS,
                1536,
            ),
        ),
        maxRetries: Math.max(0, asNumber(process.env.GEMINI_MAX_RETRIES, 3)),
        planThinkingBudget: Math.max(0, asNumber(process.env.GEMINI_PLAN_THINKING_BUDGET, 0)),
    },
    aiForThai: {
        ocrApiKey: process.env.AIFORTHAI_OCR_API_KEY,
        translateApiKey: process.env.AIFORTHAI_TRANSLATE_API_KEY,
        tfoodApiKey: process.env.AIFORTHAI_TFOOD_API_KEY,
        ocrUrl: process.env.AIFORTHAI_OCR_URL || 'https://api.aiforthai.in.th/ocr',
        translateUrl: process.env.AIFORTHAI_TRANSLATE_URL || 'https://api.aiforthai.in.th/xiaofan-en-th/th2en',
        tfoodUrl: process.env.AIFORTHAI_TFOOD_URL || 'https://api.aiforthai.in.th/thaifood',
    },
    tat: {
        apiKey: process.env.TATDATAAPI,
        apiBaseUrl: withoutTrailingSlash(
            process.env.TAT_API_BASE_URL || 'https://tatdataapi.io/api/v2',
        ),
    },
    webSearch: {
        // สวิตช์ค้นเว็บฟรีแทน Gemini grounding (ปิดแล้วระบบตอบจาก DB อย่างเดียว)
        enabled: asBoolean(process.env.WEB_SEARCH_ENABLED, true),
        providers: (process.env.WEB_SEARCH_PROVIDERS || 'tavily,wikipedia,duckduckgo')
            .split(',')
            .map((name) => name.trim().toLowerCase())
            .filter(Boolean),
        // Tavily เป็นตัวหลัก: บังคับ basic (1 credit) ห้ามใช้ advanced (2 credits)
        tavilyApiKey: process.env.TAVILY_API_KEY || '',
        tavilySearchDepth: (process.env.TAVILY_SEARCH_DEPTH || 'basic').trim().toLowerCase() === 'advanced'
            ? 'advanced'
            : 'basic',
        timeoutMs: Math.max(1000, asNumber(process.env.WEB_SEARCH_TIMEOUT_MS, 8000)),
        maxResults: Math.min(10, Math.max(1, asNumber(process.env.WEB_SEARCH_MAX_RESULTS, 5))),
        cacheTtlMs: Math.max(0, asNumber(process.env.WEB_SEARCH_CACHE_TTL_MS, 600000)),
    },
    rag: {
        // เกณฑ์ cosine similarity ขั้นต่ำของแชท — ต่ำกว่านี้ถือว่า DB ไม่มีข้อมูลที่เกี่ยวข้อง แล้วไปค้นเว็บแทน
        // (vector search คืนผลใกล้เคียงสุดเสมอแม้ไม่เกี่ยว ถ้าไม่มี threshold web search จะไม่มีวันทำงาน)
        chatSimilarityThreshold: Math.min(
            0.95,
            Math.max(0.3, asNumber(process.env.RAG_CHAT_SIMILARITY_THRESHOLD, 0.72)),
        ),
    },
};

const requiredEnvironmentVariables = [
    ['DB_PASS', config.database.password],
    ['ADMIN_JWT_SECRET', config.jwt.adminSecret],
    ['USER_JWT_SECRET', config.jwt.userSecret],
    ['GEMINI_API_KEY', config.gemini.apiKey],
    ['AIFORTHAI_OCR_API_KEY', config.aiForThai.ocrApiKey],
    ['AIFORTHAI_TRANSLATE_API_KEY', config.aiForThai.translateApiKey],
    ['AIFORTHAI_TFOOD_API_KEY', config.aiForThai.tfoodApiKey],
    ['TATDATAAPI', config.tat.apiKey],
];

// แจ้งตัวแปรสำคัญที่ยังไม่ได้กำหนด โดยไม่หยุด server ใน development
const warnAboutMissingEnvironment = () => {
    // development แจ้งเตือนเพื่อให้เปิดบาง feature ได้ตามคีย์ที่มี
    // ส่วน secret ที่กระทบ auth จะถูกตรวจแบบ fail-fast ใน jwtSecrets.js
    for (const [name, value] of requiredEnvironmentVariables) {
        if (!value) console.warn(`[env] ${name} ไม่ได้ตั้งค่าใน .env`);
    }
    if (config.webSearch.enabled && !config.webSearch.tavilyApiKey) {
        console.warn('[env] TAVILY_API_KEY ไม่ได้ตั้งค่า — web search จะใช้เฉพาะ Wikipedia/DuckDuckGo (ฟรี)');
    }
};

module.exports = { config, warnAboutMissingEnvironment };
