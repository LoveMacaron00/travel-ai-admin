// server/config/db.js

const { Pool } = require('pg');
const { config } = require('./env');

// ใช้ pool เดียวทั้ง process; controller ไม่ควรสร้าง connection ใหม่ต่อ request
const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.name,
});

module.exports = pool;
