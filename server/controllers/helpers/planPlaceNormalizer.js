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

const MANDATORY_PLACE_TIP =
    'แผนนี้รวมสถานที่ที่ผู้ใช้เลือกไว้โดยตรง แม้ความสนใจหรือวิธีเดินทางที่เลือกจะไม่ตรงทั้งหมด โปรดตรวจสอบวิธีเดินทางจริงก่อนออกเดินทาง';

const arrivalTimeForIndex = (index) => {
    const slots = ['09:00', '11:00', '13:30', '15:30', '17:00'];
    return slots[Math.min(Math.max(index, 0), slots.length - 1)];
};

const normalizeDay = (day, fallbackDayNumber) => {
    const dayNumber = Number.parseInt(String(day?.day ?? fallbackDayNumber), 10);
    return {
        ...day,
        day: Number.isInteger(dayNumber) && dayNumber > 0
            ? dayNumber
            : fallbackDayNumber,
        theme: String(day?.theme || 'สถานที่ที่ผู้ใช้เลือก'),
        stops: Array.isArray(day?.stops) ? day.stops : [],
    };
};

const planContainsPlace = (planData, place) => {
    const id = String(place?.id ?? '').trim();
    const name = normalizePlaceName(place?.name);

    for (const day of planData?.days || []) {
        for (const stop of day?.stops || []) {
            const stopId = String(stop?.destinationId ?? '').trim();
            if (id && stopId === id) return true;
            if (name && normalizePlaceName(stop?.place) === name) return true;
        }
    }
    return false;
};

const pickTargetDay = (planData, requestedDays) => {
    const currentDays = planData.days;
    if (currentDays.length === 0) {
        const day = normalizeDay({}, 1);
        currentDays.push(day);
        return day;
    }

    if (currentDays.length < requestedDays) {
        const nextDayNumber = currentDays.length + 1;
        const day = normalizeDay({}, nextDayNumber);
        currentDays.push(day);
        return day;
    }

    return currentDays.reduce((leastBusy, day) =>
        day.stops.length < leastBusy.stops.length ? day : leastBusy,
    );
};

const buildMustVisitStop = (place, day, mode) => {
    const name = String(place?.name || '').trim();
    const previous = day.stops.at(-1);
    const latitude = finiteNumber(place?.latitude);
    const longitude = finiteNumber(place?.longitude);

    return {
        destinationId: String(place?.id ?? '').trim(),
        place: name,
        activity: `แวะชม ${name}`,
        latitude: latitude ?? 0,
        longitude: longitude ?? 0,
        imageUrl: String(place?.image_url || '').trim(),
        arrivalTime: arrivalTimeForIndex(day.stops.length),
        durationMinutes: 90,
        entryCost: 0,
        foodCost: 0,
        transportMode: mode,
        transportCost: 0,
        tip: 'สถานที่นี้ถูกเพิ่มเพราะผู้ใช้เลือกไว้โดยตรง โปรดตรวจสอบเวลาเปิด-ปิดและวิธีเดินทางจริงก่อนออกเดินทาง',
        segments: previous
            ? [{
                mode,
                from: String(previous.place || ''),
                to: name,
                estimatedMinutes: 0,
                estimatedCost: 0,
            }]
            : [],
    };
};

const ensureMustVisitStops = (planData, mustVisitPlaces = [], options = {}) => {
    if (!planData || typeof planData !== 'object') return planData;

    const places = Array.isArray(mustVisitPlaces) ? mustVisitPlaces : [];
    if (places.length === 0) return planData;

    const requestedDays = Number.parseInt(String(options.days ?? 1), 10);
    const targetDayCount = Number.isInteger(requestedDays) && requestedDays > 0
        ? requestedDays
        : 1;
    const allowedModes = Array.isArray(options.allowedTransportModes)
        ? options.allowedTransportModes
            .map((mode) => String(mode || '').trim().toLowerCase())
            .filter(Boolean)
        : [];
    const mode = allowedModes[0] || 'car';

    planData.days = (Array.isArray(planData.days) ? planData.days : [])
        .filter((day) => day && typeof day === 'object')
        .map((day, index) => normalizeDay(day, index + 1));

    const seen = new Set();
    let added = false;

    for (const place of places) {
        const id = String(place?.id ?? '').trim();
        const name = normalizePlaceName(place?.name);
        const key = id || name;
        if (!key || seen.has(key) || planContainsPlace(planData, place)) {
            continue;
        }

        seen.add(key);
        const day = pickTargetDay(planData, targetDayCount);
        day.stops.push(buildMustVisitStop(place, day, mode));
        added = true;
    }

    if (added) {
        planData.tips = Array.isArray(planData.tips) ? planData.tips : [];
        if (!planData.tips.includes(MANDATORY_PLACE_TIP)) {
            planData.tips.push(MANDATORY_PLACE_TIP);
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

module.exports = {
    ensureMustVisitStops,
    normalizePlanPlaces,
    sanitizePlaceholderPlanImages,
};
