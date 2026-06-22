const TAT_API_BASE = 'https://tatdataapi.io/api/v2';

const getFirstImage = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.find(Boolean) || '';
    return '';
};

const toNumber = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
};

const normalizePlace = (place) => {
    const province = place.location?.province?.name || '';
    const district = place.location?.district?.name || '';
    const image =
        getFirstImage(place.thumbnailUrl) ||
        place.sha?.detailThumbnail ||
        place.sha?.thumbnailUrl ||
        '';

    return {
        id: place.placeId || place.id || '',
        name: place.name || 'Unknown',
        city: province || district || 'Thailand',
        location: [district, province].filter(Boolean).join(', ') || place.category?.name || 'Thailand',
        image,
        viewer: toNumber(place.viewer),
        category: place.category?.name || '',
        introduction: place.introduction || place.sha?.detail || ''
    };
};

const getTatApiKey = () => {
    const apiKey = process.env.TATDATAAPI;
    if (!apiKey || apiKey === 'your_tat_api_key_here') {
        const err = new Error('ไม่ได้ตั้งค่า TAT API Key ในระบบ (.env)');
        err.statusCode = 503;
        throw err;
    }
    return apiKey;
};

const getPopularDestinations = async ({ limit = 5 } = {}) => {
    const apiKey = getTatApiKey();

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 20);
    const params = new URLSearchParams({
        numberOfResult: '30',
        page: '1'
    });

    const response = await fetch(`${TAT_API_BASE}/places?${params}`, {
        headers: {
            'x-api-key': apiKey,
            'Accept-Language': 'th'
        }
    });

    if (!response.ok) {
        const err = new Error(`TAT API request failed with status ${response.status}`);
        err.statusCode = response.status;
        throw err;
    }

    const payload = await response.json();
    const places = Array.isArray(payload?.data) ? payload.data : [];

    return places
        .map(normalizePlace)
        .filter((place) => place.id && place.image)
        .sort((a, b) => b.viewer - a.viewer)
        .slice(0, safeLimit);
};

module.exports = {
    getPopularDestinations
};
