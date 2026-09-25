// server/services/openingHoursService.js
// หาเวลาเปิด-ปิดจากเว็บ (Tavily หลักผ่าน freeWebSearch) เมื่อ DB ไม่มีข้อมูล
// ใช้เติม stop ที่ขาดเวลาเปิดก่อน validate ตอนสร้าง/แก้แผน (gen + PUT)
// เพื่อให้ชิป "อาจปิดแล้ว" และการเตือนแม่นที่สุด — best-effort หาไม่ได้คืน null

const { freeWebSearch } = require('./webSearchHelper');
const {
    parseTimeFlexible,
    normalizeThaiName,
    buildPlacesById,
    findPlaceForStop,
    getPlaceOpeningWindow,
} = require('../utils/planScheduler');

// เวลาเปิดเปลี่ยนไม่บ่อย — cache ยาวแยกจาก cache 10 นาทีของ freeWebSearch
// (จำทั้ง "เจอ" และ "ไม่เจอ" กันยิง Tavily ซ้ำเสียเครดิต)
const HOURS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const HOURS_CACHE_MAX = 1000;
const hoursCache = new Map(); // key → { value, expires }

const getCachedHours = (key) => {
    const entry = hoursCache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expires) {
        hoursCache.delete(key);
        return undefined;
    }
    return entry.value;
};

const setCachedHours = (key, value) => {
    if (hoursCache.size >= HOURS_CACHE_MAX) {
        const oldest = hoursCache.keys().next();
        if (!oldest.done) hoursCache.delete(oldest.value);
    }
    hoursCache.set(key, { value, expires: Date.now() + HOURS_CACHE_TTL_MS });
};

const toMinutes = (hourText, minuteText) => {
    const hh = Number(hourText);
    const mm = Number(minuteText);
    if (!Number.isInteger(hh) || hh < 0 || hh > 23) return null;
    if (!Number.isInteger(mm) || mm < 0 || mm > 59) return null;
    return hh * 60 + mm;
};

const toMinutes12h = (hourText, minuteText, ap) => {
    let hh = Number(hourText);
    const mm = minuteText == null || minuteText === '' ? 0 : Number(minuteText);
    if (!Number.isInteger(hh) || hh < 1 || hh > 12) return null;
    if (!Number.isInteger(mm) || mm < 0 || mm > 59) return null;
    const isPm = String(ap || '').toLowerCase().startsWith('p');
    if (isPm && hh !== 12) hh += 12;
    if (!isPm && hh === 12) hh = 0;
    return hh * 60 + mm;
};

const fmtClock = (minutes) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

// คำบอกเวลาเปิดในข้อความ — ใช้ล็อกตำแหน่งช่วงเวลาที่น่าเชื่อถือก่อนจับเวลาดิบ
// (กันหยิบเวลารถ/ตารางเดินเรือผิด เช่น "รถออก 08:00 ถึง 09:00")
const OPENING_KEYWORDS = /เปิด|เวลา|hours?|open/i;

// ชื่อวัน (1=จันทร์..7=อาทิตย์ ตรงกับ Dart DateTime.weekday ฝั่ง client)
// ไทยจับ substring (เรียงชื่อยาวก่อนกันซ้อน) อังกฤษใช้ word boundary
const TH_DAY_NAMES = [
    ['พฤหัสบดี', 4],
    ['อาทิตย์', 7],
    ['อังคาร', 2],
    ['พฤหัส', 4],
    ['พุธ', 3],
    ['จันทร์', 1],
    ['ศุกร์', 5],
    ['เสาร์', 6],
];
const EN_DAY_NAMES = [
    ['monday', 1], ['tuesday', 2], ['wednesday', 3], ['thursday', 4],
    ['friday', 5], ['saturday', 6], ['sunday', 7],
    ['mon', 1], ['tue', 2], ['wed', 3], ['thu', 4],
    ['fri', 5], ['sat', 6], ['sun', 7],
];

// ชื่อวันที่พบในข้อความพร้อมตำแหน่ง (เรียงตามที่ปรากฏ)
const findDayMentions = (text) => {
    const mentions = [];
    const lower = String(text || '').toLowerCase();
    for (const [name, day] of TH_DAY_NAMES) {
        let from = 0;
        while (true) {
            const at = lower.indexOf(name.toLowerCase(), from);
            if (at < 0) break;
            mentions.push({ day, at, len: name.length });
            from = at + name.length;
        }
    }
    for (const [name, day] of EN_DAY_NAMES) {
        const re = new RegExp(`\\b${name}\\b`, 'gi');
        let m;
        while ((m = re.exec(text)) != null) {
            mentions.push({ day, at: m.index, len: m[0].length });
            if (m.index === re.lastIndex) re.lastIndex++;
        }
    }
    mentions.sort((a, b) => a.at - b.at);
    // ตำแหน่งเดียวจับได้หลายชื่อ (เช่น พฤหัสในพฤหัสบดี) — เอาอันเดียว (วันเดียวกันอยู่แล้ว)
    return mentions.filter(
        (mention, i) => i === 0 || mentions[i - 1].at !== mention.at,
    );
};

// ขยายช่วงวัน (รองรับข้ามสัปดาห์ เช่น ศุกร์-อังคาร → [5,6,7,1,2])
const expandDayRange = (from, to) => {
    const out = [];
    let d = from;
    for (let k = 0; k < 7; k++) {
        out.push(d);
        if (d === to) break;
        d = (d % 7) + 1;
    }
    return out;
};

// ดึงวันเปิดทำการจากข้อความ (best-effort) — คืน [1..7] หรือ null (ไม่รู้)
// ลำดับ: วันหยุดชัด ๆ ก่อน (เช่น "เปิดทุกวัน หยุดวันจันทร์" ต้องได้ [2..7])
// แล้วค่อย ทุกวัน / เสาร์-อาทิตย์ / จันทร์-ศุกร์ / รายชื่อ-ช่วงวัน
const parseOpenDaysFromText = (text) => {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return null;
    const all = [1, 2, 3, 4, 5, 6, 7];
    // 1) วันหยุด: "หยุด/ปิด (วัน)X", "closed (on) X", "หยุดเสาร์อาทิตย์", "closed weekends/weekdays"
    // สำคัญ: "เปิด" มี "ปิด" เป็น substring — ต้องกันด้วย (?<!เ) ไม่งั้น "เปิดวันเสาร์" จะกลายเป็นวันหยุด!
    const closed = new Set();
    for (const [name, day] of [...TH_DAY_NAMES, ...EN_DAY_NAMES]) {
        const plain = name.length <= 3 && /[a-z]/i.test(name);
        const pattern = plain
            ? `(?<!เ)(?:หยุด|ปิด)(?:วัน)?\\s*${name}\\b|\\bclosed(?:\\s+on)?\\s+${name}s?\\b`
            : `(?<!เ)(?:หยุด|ปิด)(?:วัน|ทำการ)?\\s*${name}|\\bclosed(?:\\s+on)?\\s+${name}s?\\b`;
        if (new RegExp(pattern, 'i').test(clean)) closed.add(day);
    }
    if (/(?<!เ)(?:หยุด|ปิด)[^\n]{0,14}(?:เสาร์|ส\.?)[\s-–—]*(?:อาทิตย์|อา\.?)/.test(clean)) {
        closed.add(6);
        closed.add(7);
    }
    if (/\bclosed[^\n]{0,14}weekends?/i.test(clean)) {
        [6, 7].forEach((d) => closed.add(d));
    }
    if (/\bclosed[^\n]{0,14}weekdays?/i.test(clean)) {
        [1, 2, 3, 4, 5].forEach((d) => closed.add(d));
    }
    if (closed.size > 0 && closed.size < 7) {
        return all.filter((d) => !closed.has(d));
    }
    // 2) เปิดทุกวัน
    if (/เปิดทุกวัน|เปิด\s*ประจำ|open\s*(every\s*)?daily|open\s*every\s*day/i.test(clean)) {
        return [...all];
    }
    // 3) เสาร์-อาทิตย์ / จันทร์-ศุกร์
    if (/weekends?(\s*only)?\b|เสาร์[\s.]*[-–—][\s.]*อาทิตย์|ส\.?\s*[-–—]\s*อา\.?|sat(urday)?\s*[-–—]\s*sun(day)?/i.test(clean)) {
        return [6, 7];
    }
    if (/\bweekdays?\b|จันทร์[\s.]*[-–—][\s.]*ศุกร์|mon(day)?\s*[-–—]\s*fri(day)?/i.test(clean)) {
        return [1, 2, 3, 4, 5];
    }
    // 4) รายชื่อ/ช่วงวัน ("เปิด ศุกร์ เสาร์ อาทิตย์", "จันทร์-ศุกร์")
    const mentions = findDayMentions(clean);
    if (mentions.length === 0) return null;
    if (mentions.length === 2) {
        const between = clean.slice(
            mentions[0].at + mentions[0].len,
            mentions[1].at,
        );
        if (/^\s*(?:[-–—]|ถึง|to)\s*$/i.test(between)) {
            return expandDayRange(mentions[0].day, mentions[1].day);
        }
    }
    return [...new Set(mentions.map((m) => m.day))].sort((a, b) => a - b);
};

// ดึงช่วงเวลาเปิด-ปิดจากข้อความผลค้นหา (best-effort) — คืน {open, close} นาที หรือ null
// รองรับ "08:00-17:00", "8.00–17.00", "เปิด 09:00 ปิด 18:00", "9am - 5pm",
// "เปิด 24 ชั่วโมง" (คืน {0,0} = เปิดตลอด = ไม่บล็อก) และข้ามคืนอย่าง "15:00-02:00"
const parseOpeningHoursFromText = (text) => {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return null;
    // เปิดตลอด 24 ชม. — {0,0} หมายถึงไม่จำกัด (isWithinOpeningHours คืน true เสมอ)
    if (/เปิด\s*(ตลอด|24\s*(ชั่วโมง|ชม|hours?)?)|open\s*24|24\s*\/\s*7/i.test(clean)) {
        return { open: 0, close: 0 };
    }
    const valid = ({ open, close }) => {
        if (open == null || close == null) return null;
        // "00:00-00:00" ถือว่าไม่ระบุ (DB ใช้ค่านี้เป็น unknown)
        if (open === 0 && close === 0) return null;
        return { open, close };
    };
    // 1) ช่วงเวลาอยู่ใกล้คำบอกเวลาเปิด ("เวลาเปิด 08:00-17:00", "opening hours 9:00-18:00")
    const anchored = clean.match(
        /(?:เวลาเปิด|เวลาทำการ|เปิดทำการ|opening\s*hours?|open\s*hours?|hours?)[^0-9APMapm.]{0,30}?(\d{1,2})\s*[:.]\s*(\d{2})\s*(?:[-–—~]|ถึง)\s*(\d{1,2})\s*[:.]\s*(\d{2})/i,
    );
    if (anchored) {
        const hit = valid({
            open: toMinutes(anchored[1], anchored[2]),
            close: toMinutes(anchored[3], anchored[4]),
        });
        if (hit) return hit;
    }
    // 2) รูป "เปิด HH:MM ... ปิด HH:MM"
    const openClose = clean.match(
        /เปิด\s*(\d{1,2})\s*[:.]\s*(\d{2})[^0-9]{0,20}ปิด\s*(\d{1,2})\s*[:.]\s*(\d{2})/,
    );
    if (openClose) {
        const hit = valid({
            open: toMinutes(openClose[1], openClose[2]),
            close: toMinutes(openClose[3], openClose[4]),
        });
        if (hit) return hit;
    }
    // 3) แบบ am/pm ("9am - 5pm", "9:00 AM–5:00 PM")
    const ampm = clean.match(
        /(\d{1,2})(?::(\d{2}))?\s*([AP])\.?\s*M\.?\s*(?:[-–—~]|ถึง)\s*(\d{1,2})(?::(\d{2}))?\s*([AP])\.?\s*M\.?/i,
    );
    if (ampm) {
        const hit = valid({
            open: toMinutes12h(ampm[1], ampm[2], ampm[3]),
            close: toMinutes12h(ampm[4], ampm[5], ampm[6]),
        });
        if (hit) return hit;
    }
    // 4) ช่วงเวลาดิบ ("08:00-17:00") — เอาเฉพาะเมื่อข้อความพูดเรื่องเวลาเปิดจริง ๆ
    if (OPENING_KEYWORDS.test(clean)) {
        const bare = clean.match(/(\d{1,2})\s*[:.]\s*(\d{2})\s*(?:[-–—~]|ถึง)\s*(\d{1,2})\s*[:.]\s*(\d{2})/);
        if (bare) {
            const hit = valid({
                open: toMinutes(bare[1], bare[2]),
                close: toMinutes(bare[3], bare[4]),
            });
            if (hit) return hit;
        }
    }
    return null;
};

// ค้นเวลาเปิด-ปิด + วันเปิดทำการของสถานที่จากเว็บ (Tavily หลัก)
// คืน {open, close, days?} (days = [1..7] จันทร์..อาทิตย์, ไม่มี = ไม่รู้) หรือ null
async function findOpeningHoursViaWeb(placeName, province) {
    const name = String(placeName || '').trim();
    if (!name) return null;
    const key = normalizeThaiName(`${name}|${province || ''}`);
    const cached = getCachedHours(key);
    if (cached !== undefined) return cached;
    let found = null;
    try {
        const query = `${name} ${province || ''} เวลาเปิดปิด`.trim();
        const results = await freeWebSearch(query, { limit: 5 });
        for (const item of results || []) {
            const text = `${item?.title || ''} ${item?.snippet || ''}`;
            const hours = parseOpeningHoursFromText(text);
            const days = parseOpenDaysFromText(text);
            if (hours || days) {
                found = { ...(hours || {}), ...(days ? { days } : {}) };
                if (hours) break;
                // มีแค่วันเปิด ยังดูผลถัดไปเผื่อมีเวลาด้วย
            }
        }
    } catch {
        found = null;
    }
    setCachedHours(key, found);
    return found;
}

// เติมเวลาเปิด-ปิด + วันเปิดทำการให้ stop ที่ DB ไม่มี (mutate planData) — คืนจำนวนที่เติมได้
// ใช้ก่อน validate ตอนสร้าง/แก้แผน เพื่อให้ชิป "อาจปิดแล้ว" แม่นที่สุด
// รอบแรก: stop ที่ขาดเวลาเปิด / รอบสอง (งบเหลือ): stop ที่มีเวลาแล้วแต่ขาดวันเปิด
// ข้าม stop ที่ DB มีเวลา (validate เจอเอง ไม่ต้องเสียเครดิต) — จำกัดจำนวนครั้งกันช้า/เปลืองเครดิต
const hasOwnHours = (stop) =>
    parseTimeFlexible(stop?.openingTime ?? stop?.opening_time) != null &&
    parseTimeFlexible(stop?.closingTime ?? stop?.closing_time) != null;

const hasOpenDays = (stop) =>
    Array.isArray(stop?.openDays) &&
    stop.openDays.some((d) => Number.isInteger(d) && d >= 1 && d <= 7);

async function enrichMissingOpeningHours(planData, places = [], { maxLookups = 5 } = {}) {
    if (!planData || typeof planData !== 'object') return { filled: 0 };
    const index = buildPlacesById(places);
    const budget = Math.max(1, Number(maxLookups) || 5);
    const targets = [];
    const collectTargets = (needDays) => {
        for (const day of planData.days || []) {
            for (const stop of day?.stops || []) {
                if (!stop || typeof stop !== 'object') continue;
                if (!String(stop.place || '').trim()) continue;
                if (targets.includes(stop)) continue;
                if (needDays) {
                    if (hasOwnHours(stop) && !hasOpenDays(stop)) targets.push(stop);
                } else {
                    if (hasOwnHours(stop)) continue;
                    const place = findPlaceForStop(stop, index);
                    if (place && getPlaceOpeningWindow(place)) continue;
                    targets.push(stop);
                }
                if (targets.length >= budget) return;
            }
            if (targets.length >= budget) return;
        }
    };
    collectTargets(false);
    collectTargets(true);
    let filled = 0;
    await Promise.all(
        targets.map(async (stop) => {
            const found = await findOpeningHoursViaWeb(stop.place, stop.province);
            if (!found) return;
            let touched = false;
            if (found.open != null && found.close != null) {
                stop.openingTime = fmtClock(found.open);
                stop.closingTime = fmtClock(found.close);
                touched = true;
            }
            // วันเปิดแปะแยก (มีแค่บางผลค้นหา) — ครบทั้งสัปดาห์เท่ากับไม่จำกัด ไม่ต้องเก็บ
            if (Array.isArray(found.days) && found.days.length > 0 && found.days.length < 7) {
                const clean = [...new Set(found.days)].filter(
                    (d) => Number.isInteger(d) && d >= 1 && d <= 7,
                ).sort((a, b) => a - b);
                if (clean.length > 0 && clean.length < 7) {
                    stop.openDays = clean;
                    touched = true;
                }
            }
            if (touched) filled++;
        }),
    );
    return { filled };
}

module.exports = {
    parseOpeningHoursFromText,
    parseOpenDaysFromText,
    findOpeningHoursViaWeb,
    enrichMissingOpeningHours,
};
