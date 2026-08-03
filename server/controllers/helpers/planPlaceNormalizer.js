const normalizePlaceName = (value) => String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('th')
    .replace(/[^\p{L}\p{N}]+/gu, '');

const finiteNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const isPlaceholderMediaUrl = (value) => {
    let url;
    try {
        url = new URL(String(value || ''));
    } catch {
        return false;
    }

    const host = url.hostname.toLowerCase();
    const documentationDomains = ['example.com', 'example.org', 'example.net'];
    return documentationDomains.some(
        domain => host === domain || host.endsWith(`.${domain}`),
    ) || host.endsWith('.invalid');
};

// Keep historical plan data intact in PostgreSQL, but never expose known fake
// documentation URLs to clients that read an older plan.
const sanitizePlaceholderPlanImages = (planData) => {
    for (const day of planData?.days || []) {
        for (const stop of day?.stops || []) {
            if (isPlaceholderMediaUrl(stop?.imageUrl)) stop.imageUrl = '';
        }
    }
    return planData;
};

// Gemini may invent image URLs even when the prompt says to use database rows.
// Only a destination matched to the retrieved database context may supply media.
const normalizePlanPlaces = (planData, places = []) => {
    if (!planData || typeof planData !== 'object') return planData;

    const destinations = Array.isArray(places) ? places : [];
    const byId = new Map();
    const byName = new Map();

    for (const place of destinations) {
        if (!place || typeof place !== 'object') continue;

        const id = String(place.id ?? '').trim();
        const name = normalizePlaceName(place.name);
        if (id) byId.set(id, place);
        if (name) byName.set(name, place);
    }

    for (const day of planData?.days || []) {
        const verifiedStops = [];
        for (const stop of day?.stops || []) {
            if (!stop || typeof stop !== 'object') continue;

            const requestedId = String(stop.destinationId ?? '').trim();
            const requestedName = normalizePlaceName(stop.place);
            const nameMatch = requestedName ? byName.get(requestedName) : null;
            const idMatch = requestedId ? byId.get(requestedId) : null;
            const idName = normalizePlaceName(idMatch?.name);
            const matched = nameMatch || (
                idMatch && (!requestedName || requestedName === idName) ? idMatch : null
            );

            if (!matched) {
                continue;
            }

            stop.destinationId = String(matched.id);
            stop.imageUrl = String(matched.image_url || '').trim();

            const latitude = finiteNumber(matched.latitude);
            const longitude = finiteNumber(matched.longitude);
            if (latitude != null) stop.latitude = latitude;
            if (longitude != null) stop.longitude = longitude;
            verifiedStops.push(stop);
        }
        day.stops = verifiedStops;
    }

    // Do not leave empty AI-invented days in the rendered itinerary.
    planData.days = (planData?.days || []).filter(day => day.stops.length > 0);

    return planData;
};

module.exports = { normalizePlanPlaces, sanitizePlaceholderPlanImages };
