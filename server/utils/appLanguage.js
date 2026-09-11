const SUPPORTED_APP_LANGUAGES = new Set(['en', 'th']);

// Accept-Language อาจมี region, quality value และหลายภาษา เช่น th-TH,en;q=0.9
// เลือกภาษาที่แอปรองรับตัวแรก และใช้ภาษาไทยเป็นค่าเริ่มต้นของแอป
// เลือกภาษา th/en ตัวแรกที่รองรับจาก HTTP Accept-Language
const resolveAppLanguage = (acceptLanguage) => {
    const requestedLanguages = String(acceptLanguage || '')
        .split(',')
        .map((entry) => entry.trim().split(';')[0].toLowerCase())
        .filter(Boolean);

    for (const requestedLanguage of requestedLanguages) {
        const languageCode = requestedLanguage.split('-')[0];
        if (SUPPORTED_APP_LANGUAGES.has(languageCode)) return languageCode;
    }

    return 'th';
};

module.exports = { resolveAppLanguage };
