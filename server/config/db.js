// server/config/db.js

const { Pool } = require('pg');
const { config } = require('./env');

const pool = new Pool({ 
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.name,
});

module.exports = pool;
