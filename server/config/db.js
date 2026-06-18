const { Pool } = require('pg');
const path = require('path');
require("dotenv").config({ path: path.resolve(__dirname, '../../.env') });

const pool = new Pool({ 
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME 
});

module.exports = pool;
