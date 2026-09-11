// server/services/tatPlaceFormatter.js

// ลบ HTML และช่องว่างส่วนเกินออกจากข้อความที่มาจาก TAT
const stripHtml = (value = '') => String(value).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

// คืนข้อความสะอาดที่ไม่ว่างค่าแรกจากชุดข้อมูลสำรอง
const firstText = (...values) => {
    for (const value of values) {
        if (value === null || value === undefined) continue;
        const text = stripHtml(value);
        if (text) return text;
    }
    return '';
};

// เลือก payload ดิบของ TAT หากมี หรือใช้ข้อมูลสถานที่ปัจจุบัน
const getRaw = (place = {}) => place.tat_raw || place;

// ดึงข้อมูลค่าเข้าชมจากข้อความอธิบายเมื่อ API ไม่ส่ง field ค่าธรรมเนียม
const extractFeeFromDescription = (place = {}) => {
    const raw = getRaw(place);
    const text = firstText(
        raw.information?.detail,
        raw.detail,
        place.description,
    );
    if (!text) return '';

    const freeMatch = text.match(/(?:เข้าชมฟรี|ไม่เสียค่า(?:เข้า|เข้าชม)|ค่าเข้าชมฟรี|free\s+(?:entry|admission))/i);
    if (freeMatch) return 'เข้าชมฟรี';

    const matches = [];
    const patterns = [
        /(?:ผู้ใหญ่|adult(?:s)?)\s*(?:ราคา|คนละ|ท่านละ|[:：-])?\s*(?:ประมาณ)?\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(?:บาท|baht|thb)/i,
        /(?:เด็ก|child(?:ren)?)\s*(?:ราคา|คนละ|ท่านละ|[:：-])?\s*(?:ประมาณ)?\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(?:บาท|baht|thb)/i,
        /(?:ค่าเข้าชม|ค่าเข้า|entrance\s*fee|admission(?:\s*fee)?)\s*(?:ราคา|คนละ|ท่านละ|[:：-])?\s*(?:ประมาณ)?\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(?:บาท|baht|thb)/i,
    ];
    const labels = ['ผู้ใหญ่', 'เด็ก', 'ค่าเข้าชม'];
    for (let index = 0; index < patterns.length; index++) {
        const match = text.match(patterns[index]);
        if (match) matches.push(`${labels[index]} ${match[1].replace(/,/g, '')} บาท`);
    }
    return matches.join(', ');
};

// จัดรูปแบบจำนวนเงินโดยเก็บทศนิยมเฉพาะเมื่อจำเป็น
const formatMoney = (value) => {
    if (value === null || value === undefined || value === '') return '';
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value).trim();
    return Number.isInteger(number) ? String(number) : number.toFixed(2);
};

// สร้างข้อความเวลาเปิด-ปิดจากรายการรายวันหรือเวลา fallback
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

// รวมค่าเข้าชมเป็นข้อความสำหรับแสดงผล พร้อม fallback จากคำบรรยาย
const buildFeeText = (place = {}) => {
    const raw = getRaw(place);
    const fee = raw.information?.fee || raw.fee || {};
    const adult = formatMoney(fee.thaiAdult);
    const child = formatMoney(fee.thaiChild);
    const details = firstText(fee.detail);

    const parts = [];
    if (adult) parts.push(`ผู้ใหญ่ ${adult} บาท`);
    if (child) parts.push(`เด็ก ${child} บาท`);
    if (details) parts.push(details);

    return parts.join(', ') || extractFeeFromDescription(place);
};

// เลือกเบอร์โทรติดต่อจากข้อมูลสถานที่และ payload ดิบ
const buildContactText = (place = {}) => {
    const raw = getRaw(place);
    return firstText(place.mobile, raw.mobile, raw.telephone);
};

// สร้างคำอธิบายสถานที่แบบตัดความยาวสูงสุดที่กำหนด
const buildDetailText = (place = {}, maxLength = 800) => {
    const raw = getRaw(place);
    const detail = firstText(
        raw.information?.detail,
        raw.detail,
        place.description
    );

    return detail.length > maxLength ? `${detail.slice(0, maxLength)}...` : detail;
};

// สร้างข้อความเวลาเปิด-ปิดสำหรับสถานที่หนึ่งแห่ง
const buildOpeningHoursText = (place = {}) => {
    const raw = getRaw(place);
    return formatOpeningHours(
        place.opening_hours || raw.openingHours,
        place.opening_time,
        place.closing_time
    );
};

// รวบรวม facts ที่พร้อมใช้แสดงผลจากข้อมูลสถานที่
const buildPlaceFacts = (place = {}) => ({
    openingHoursText: buildOpeningHoursText(place),
    feeText: buildFeeText(place),
    contactText: buildContactText(place),
    detailText: buildDetailText(place),
});

module.exports = {
    stripHtml,
    buildPlaceFacts,
};
