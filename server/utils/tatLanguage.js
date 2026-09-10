const { resolveAppLanguage } = require('./appLanguage');

const resolveTatLanguage = resolveAppLanguage;

// สร้าง header ที่ TAT API ต้องใช้พร้อมภาษาที่ระบบรองรับ
const tatHeadersFor = (apiKey, acceptLanguage) => ({
    'x-api-key': apiKey,
    'Accept-Language': resolveTatLanguage(acceptLanguage),
});

module.exports = { resolveTatLanguage, tatHeadersFor };
