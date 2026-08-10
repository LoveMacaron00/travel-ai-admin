const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const normalizeOrigin = (origin) => String(origin || '').trim().replace(/\/+$/, '');

const isLoopbackOrigin = (origin) => {
    try {
        const url = new URL(origin);
        return (url.protocol === 'http:' || url.protocol === 'https:')
            && LOOPBACK_HOSTS.has(url.hostname)
            && normalizeOrigin(url.origin) === origin;
    } catch {
        return false;
    }
};

const isOriginAllowed = ({ origin, allowedOrigins, nodeEnv }) => {
    // Mobile/CLI requests usually have no Origin header and are not governed by CORS.
    if (!origin) return true;

    const normalizedOrigin = normalizeOrigin(origin);
    const configuredOrigins = allowedOrigins.map(normalizeOrigin);
    if (configuredOrigins.includes(normalizedOrigin)) return true;

    // flutter run chooses a dynamic port unless --web-port is supplied. Allow only
    // loopback hosts in non-production so Chrome development works on either host.
    return nodeEnv !== 'production' && isLoopbackOrigin(normalizedOrigin);
};

const createCorsOptions = ({ allowedOrigins, nodeEnv }) => ({
    origin(origin, callback) {
        callback(null, isOriginAllowed({ origin, allowedOrigins, nodeEnv }));
    },
    credentials: true,
    maxAge: 86400,
});

module.exports = { createCorsOptions };
