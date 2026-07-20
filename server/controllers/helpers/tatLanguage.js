const { resolveAppLanguage } = require('./appLanguage');

const resolveTatLanguage = resolveAppLanguage;

const tatHeadersFor = (apiKey, acceptLanguage) => ({
    'x-api-key': apiKey,
    'Accept-Language': resolveTatLanguage(acceptLanguage),
});

module.exports = { resolveTatLanguage, tatHeadersFor };
