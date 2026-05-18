const { Pool } = require('pg');
// โหลดตัวแปรสภาพแวดล้อมจากไฟล์ .env ที่อยู่ในโฟลเดอร์หลักของโปรเจค
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// ตั้งค่าการเชื่อมต่อ PostgreSQL
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'smarttravel',
});

/**
 * ฟังก์ชันช่วยสำหรับรัน query
 * @param {string} text - SQL query string
 * @param {Array} params - พารามิเตอร์สำหรับ parameterized query
 * @returns {import('pg').QueryResult}
 */
async function query(text, params) {
    return pool.query(text, params);
}

module.exports = { pool, query };
