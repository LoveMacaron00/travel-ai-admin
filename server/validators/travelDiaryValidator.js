// server/validators/travelDiaryValidator.js
// ตรวจและ normalize ข้อมูลบันทึกการเดินทางจาก request — ย้ายออกจาก travelDiaryController
// พฤติกรรมเดิมทุกประการ Controller จับ TypeError แล้วตอบ 400 เหมือนเดิม

const allowedSources = new Set(['manual', 'gps', 'aiCamera', 'imported']);

const stringValue = (value, maxLength) => {
    if (value === undefined || value === null) return '';
    return String(value).trim().slice(0, maxLength);
};

const nullableNumber = (value, minimum, maximum) => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
        throw new TypeError('invalid-number');
    }
    return parsed;
};

// แปลง body เป็น entry ที่พร้อมบันทึก โยน TypeError('invalid-entry') เมื่อข้อมูลไม่ถูกต้อง
const parseEntry = (body = {}) => {
    const externalId = stringValue(body.id, 100);
    const startedAt = new Date(body.date);
    const lastSeenAt = body.lastSeenAt ? new Date(body.lastSeenAt) : null;
    const destinationId = body.destinationId === undefined || body.destinationId === null
        ? null
        : Number(body.destinationId);
    const source = stringValue(body.source || 'manual', 30);
    const imageUrls = Array.isArray(body.imageUrls)
        ? body.imageUrls
            .map((url) => stringValue(url, 2048))
            .filter((url) => url.startsWith('/') || /^https?:\/\//i.test(url))
            .slice(0, 8)
        : [];

    if (!externalId || Number.isNaN(startedAt.getTime())) {
        throw new TypeError('invalid-entry');
    }
    if (lastSeenAt && Number.isNaN(lastSeenAt.getTime())) {
        throw new TypeError('invalid-entry');
    }
    if (destinationId !== null && (!Number.isInteger(destinationId) || destinationId <= 0)) {
        throw new TypeError('invalid-entry');
    }
    if (!allowedSources.has(source)) throw new TypeError('invalid-entry');

    return {
        externalId,
        destinationId,
        startedAt,
        lastSeenAt,
        title: stringValue(body.title, 500),
        note: stringValue(body.note, 10000),
        province: stringValue(body.province, 255),
        insight: stringValue(body.insight, 10000),
        imageUrls,
        latitude: nullableNumber(body.latitude, -90, 90),
        longitude: nullableNumber(body.longitude, -180, 180),
        source,
    };
};

module.exports = { allowedSources, stringValue, nullableNumber, parseEntry };
