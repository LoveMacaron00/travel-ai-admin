// server/middleware/userAuth.js — now delegates to unified auth.js (behavior identical)
const { requireUserAuth } = require('./auth');

module.exports = { requireUserAuth };
