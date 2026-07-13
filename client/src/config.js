export const appConfig = {
    apiBaseUrl: import.meta.env.VITE_API_BASE_URL || '/api',
    nominatimBaseUrl:
        import.meta.env.VITE_NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org',
    mapTileUrl:
        import.meta.env.VITE_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
};
