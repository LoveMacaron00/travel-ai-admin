// VITE_* จะถูกฝังใน browser bundle จึงเก็บได้เฉพาะ URL สาธารณะ ห้ามใส่ secret
export const appConfig = {
    apiBaseUrl: import.meta.env.VITE_API_BASE_URL || '/api',
    nominatimBaseUrl:
        import.meta.env.VITE_NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org',
    mapTileUrl:
        import.meta.env.VITE_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
};

export const resolveAssetUrl = (source = '') => {
    if (!source || /^https?:\/\//i.test(source)) return source;
    if (!source.startsWith('/')) return source;

    if (/^https?:\/\//i.test(appConfig.apiBaseUrl)) {
        return new URL(source, new URL(appConfig.apiBaseUrl).origin).toString();
    }
    return source;
};

export const isPrivateUploadUrl = (source = '') => {
    try {
        const resolved = new URL(resolveAssetUrl(source), window.location.origin);
        const apiOrigin = /^https?:\/\//i.test(appConfig.apiBaseUrl)
            ? new URL(appConfig.apiBaseUrl).origin
            : window.location.origin;
        return resolved.origin === apiOrigin && resolved.pathname.startsWith('/uploads/');
    } catch {
        return false;
    }
};
