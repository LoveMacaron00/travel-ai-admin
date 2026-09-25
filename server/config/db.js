// server/config/db.js

const { Pool, types } = require('pg');
const { config } = require('./env');

// คอลัมน์ DATE (เช่น trips.start_date) คืนเป็น string 'YYYY-MM-DD' ตรง ๆ ไม่แปลงเป็น Date
// (node-pg แปลง DATE เป็น Date object ที่ UTC midnight — JSON serialize ในโซน +07
// จะย้อนเป็นวันก่อนหน้า ทำให้วันที่โชว์บนแอปไม่ตรงกับที่เลือก)
types.setTypeParser(1082, (value) => value);

// ใช้ pool เดียวทั้ง process;
const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.name,
});

module.exports = pool;
