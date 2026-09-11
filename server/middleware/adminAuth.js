// server/middleware/adminAuth.js — now delegates to unified auth.js to reduce duplication (behavior identical)
const { requireAdminAuth } = require('./auth');

module.exports = { requireAdminAuth };
