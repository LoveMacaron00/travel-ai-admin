// config/env.js — central config สำหรับทั้ง project
// ทุกไฟล์ใช้ const { X } = require('../config/env') แทน process.env.X

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const env = {
    // Server
    PORT: process.env.PORT || 5000,

    // PostgreSQL
    DB_HOST: process.env.DB_HOST || 'localhost',
    DB_PORT: parseInt(process.env.DB_PORT || '5432', 10),
    DB_USER: process.env.DB_USER || 'postgres',
    DB_PASS: process.env.DB_PASS || '',
    DB_NAME: process.env.DB_NAME || 'smarttravel',

    // JWT
    ADMIN_JWT_SECRET: process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || 'dev-admin-secret',
    USER_JWT_SECRET : process.env.USER_JWT_SECRET  || process.env.JWT_SECRET || 'dev-user-secret',

    // AI APIs
    OPENAI_API_KEY    : process.env.OPENAI_API_KEY,
    GEMINI_API_KEY    : process.env.GEMINI_API_KEY,
    GEMINI_MODEL      : 'gemini-1.5-flash',
    EMBED_MODEL       : 'text-embedding-3-small',

    // TAT
    TAT_API_KEY  : process.env.TATDATAAPI,
    TAT_API_BASE : 'https://tatdataapi.io/api/v2',
};

// ตรวจ required keys ตอน startup — warn ถ้าขาด
const REQUIRED = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'TAT_API_KEY'];
for (const key of REQUIRED) {
    if (!env[key]) console.warn(`[env] ⚠️  ${key} ไม่ได้ตั้งค่าใน .env`);
}

module.exports = env;
