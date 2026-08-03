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
        apiKey: process.env.GEMINI_API_KEY,
        apiBaseUrl: withoutTrailingSlash(
            process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta',
        ),
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001',
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
};

module.exports = { config, warnAboutMissingEnvironment };
