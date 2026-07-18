const SUPPORTED_TAT_LANGUAGES = new Set(['en', 'th']);

const resolveTatLanguage = (acceptLanguage) => {
    const requestedLanguages = String(acceptLanguage || '')
        .split(',')
        .map((entry) => entry.trim().split(';')[0].toLowerCase())
        .filter(Boolean);

    for (const requestedLanguage of requestedLanguages) {
        const languageCode = requestedLanguage.split('-')[0];
        if (SUPPORTED_TAT_LANGUAGES.has(languageCode)) return languageCode;
    }

    return 'th';
};

const tatHeadersFor = (apiKey, acceptLanguage) => ({
    'x-api-key': apiKey,
    'Accept-Language': resolveTatLanguage(acceptLanguage),
});

module.exports = { resolveTatLanguage, tatHeadersFor };
