const { Pool } = require('pg');
const { DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME } = require('./config/env');

const pool = new Pool({ host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASS, database: DB_NAME });

async function query(text, params) {
    return pool.query(text, params);
}

module.exports = { pool, query };
