const stripHtml = (value = '') => String(value).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

const firstText = (...values) => {
    for (const value of values) {
        if (value === null || value === undefined) continue;
        const text = stripHtml(value);
        if (text) return text;
    }
    return '';
};

const getRaw = (place = {}) => place.tat_raw || place;

const formatMoney = (value) => {
    if (value === null || value === undefined || value === '') return '';
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value).trim();
    return Number.isInteger(number) ? String(number) : number.toFixed(2);
};

const formatOpeningHours = (openingHours, fallbackOpen, fallbackClose) => {
    if (Array.isArray(openingHours) && openingHours.length > 0) {
        const rows = openingHours
            .map((item) => {
                const day = firstText(item.day);
                const open = firstText(item.open);
                const close = firstText(item.close);
                const text = firstText(item.description);

                if (text) return [day, text].filter(Boolean).join(' ');
                if (open && close) return [day, `${open} - ${close}`].filter(Boolean).join(' ');
                if (open) return [day, open].filter(Boolean).join(' ');
                return '';
            })
            .filter(Boolean);

        if (rows.length === 1) return rows[0];
        if (rows.length > 1) return rows.join('; ');
    }

    if (fallbackOpen && fallbackClose && fallbackOpen !== '00:00') {
        return `${fallbackOpen} - ${fallbackClose}`;
    }

    return '';
};

const buildFeeText = (place = {}) => {
    const raw = getRaw(place);
    const fee = raw.information?.fee || raw.fee || {};
    const adult = formatMoney(place.price_adult ?? fee.thaiAdult);
    const child = formatMoney(place.price_child ?? fee.thaiChild);
    const details = firstText(fee.detail);

    const parts = [];
    if (adult) parts.push(`ผู้ใหญ่ ${adult} บาท`);
    if (child) parts.push(`เด็ก ${child} บาท`);
    if (details) parts.push(details);

    return parts.join(', ');
};

const buildContactText = (place = {}) => {
    const raw = getRaw(place);
    return firstText(place.mobile, raw.mobile, raw.telephone);
};

const buildDetailText = (place = {}, maxLength = 800) => {
    const raw = getRaw(place);
    const detail = firstText(
        raw.information?.detail,
        raw.detail,
        place.description
    );

    return detail.length > maxLength ? `${detail.slice(0, maxLength)}...` : detail;
};

const buildOpeningHoursText = (place = {}) => {
    const raw = getRaw(place);
    return formatOpeningHours(
        place.opening_hours || raw.openingHours,
        place.opening_time,
        place.closing_time
    );
};

const buildPlaceFacts = (place = {}) => ({
    openingHoursText: buildOpeningHoursText(place),
    feeText: buildFeeText(place),
    contactText: buildContactText(place),
    detailText: buildDetailText(place),
});

module.exports = {
    stripHtml,
    formatOpeningHours,
    buildFeeText,
    buildContactText,
    buildDetailText,
    buildOpeningHoursText,
    buildPlaceFacts,
};
