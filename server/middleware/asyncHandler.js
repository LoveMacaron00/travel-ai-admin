// server/middleware/asyncHandler.js
// Centralized async wrapper — previously every controller duplicated
// try/catch with `console.error('[xxx]:', err.message)` + `res.status(500).json({message:'...'})`
// and SSE `if(!res.headersSent) res.status(500)` patterns.
// This helper keeps behavior identical but removes duplication.
// Usage: router.get('/path', asyncHandler(async (req,res)=>{ ... }))
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = { asyncHandler };
