// server/utils/planScheduler.js
//
// คำนวณตารางเวลาทริปแบบ deterministic จากพิกัดจริงใน DB (ไม่ใช่ให้ AI เดาเวลา)
// ใช้ 2 จุด:
//  1. aiHelper.generateTripPlan — จัดลำดับในแต่ละวันจากจุดเริ่มต้นจริง + เดินโซ่เวลา
//  2. tripController.updateTripPlan (PUT) — คำนวณเวลาใหม่โดยคงลำดับที่ผู้ใช้จัดเอง

const MODE_SPEEDS_KMH = {
    walking: 5,
    car: 50,
    bus: 40,
    train: 70,
    ferry: 28,
    flight: 550,
};

// เวลา overhead ต่อขา (รอขึ้นเครื่อง/เรือ/รถไฟ) — รวมในนาทีเดินทางเลย
const MODE_OVERHEAD_MINUTES = {
    walking: 0,
    car: 0,
    bus: 10,
    train: 30,
    ferry: 30,
    flight: 120,
};

// กรอบเวลาต่อวัน ~10 ชม. (เช่น 09:00–19:00) ใช้นับว่าแผนแน่นเกินไปหรือไม่
const DAY_BUDGET_MINUTES = 600;
const MAX_STOPS_PER_DAY = 5;
const DEFAULT_DAY_START_MINUTES = 9 * 60;

const clampDurationMinutes = (value, fallback = 90) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(300, Math.max(20, Math.round(parsed)));
};

// "09:30" → 570, แปลงไม่ได้ → null
const parseClockToMinutes = (value) => {
    const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
};

// input start_time จาก mobile ("HH:MM") — ใช้ไม่ได้ให้เริ่ม 09:00
const parseStartTimeInput = (value) => parseClockToMinutes(value) ?? DEFAULT_DAY_START_MINUTES;

const formatClock = (totalMinutes) => {
    const wrapped = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
    return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
};

const finiteCoord = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const haversineKm = (aLat, aLng, bLat, bLng) => {
    const lat1 = finiteCoord(aLat);
    const lng1 = finiteCoord(aLng);
    const lat2 = finiteCoord(bLat);
    const lng2 = finiteCoord(bLng);
    if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(a));
};

// นาทีเดินทางตามระยะทางจริง + พาหนะ (รวม overhead) และนาทีพักสำหรับขายาว
// ขายาวทางถนน (≥2 ชม.) เผื่อพัก 20 นาที/2 ชม. — เป็นจุดพักโดยประมาณ ไม่ใช่จุดตายตัว
const computeLegMinutes = (km, modeRaw) => {
    const mode = String(modeRaw || 'car').toLowerCase();
    const distance = Number(km);
    if (!Number.isFinite(distance) || distance < 0) return { travelMinutes: 30, restMinutes: 0 };
    const speed = MODE_SPEEDS_KMH[mode] || 40;
    const overhead = MODE_OVERHEAD_MINUTES[mode] || 0;
    const travelMinutes = Math.max(5, Math.round((distance / speed) * 60 + overhead));
    let restMinutes = 0;
    if (['car', 'bus', 'train'].includes(mode) && travelMinutes >= 120) {
        restMinutes = Math.floor(travelMinutes / 120) * 20;
    }
    return { travelMinutes, restMinutes };
};

const appendRestNote = (tip, travelMinutes, restMinutes) => {
    const base = String(tip || '').trim();
    if (base.includes('พักระหว่างทาง')) return base;
    const hours = Math.round((travelMinutes / 60) * 10) / 10;
    const note = `ขานี้เดินทางนาน ~${hours} ชม. เผื่อพักระหว่างทาง ${restMinutes} นาทีแล้ว`;
    return base ? `${base} ${note}` : note;
};

// จัดลำดับจุดแวะในวันนั้นแบบ greedy nearest-neighbor จากจุดเริ่มต้นจริง
// เพื่อลดการย้อนเส้นทาง — ไม่ fix ลำดับตายตัว
const orderStopsNearestNeighbor = (stops, startLat, startLng) => {
    const remaining = [...stops];
    const ordered = [];
    let lat = startLat;
    let lng = startLng;
    while (remaining.length > 0) {
        let best = 0;
        let bestKm = null;
        for (let i = 0; i < remaining.length; i++) {
            const km = haversineKm(lat, lng, remaining[i].latitude, remaining[i].longitude);
            const score = km == null ? Number.MAX_SAFE_INTEGER : km;
            if (bestKm == null || score < bestKm) {
                bestKm = score;
                best = i;
            }
        }
        const [next] = remaining.splice(best, 1);
        ordered.push(next);
        const nextLat = finiteCoord(next.latitude);
        const nextLng = finiteCoord(next.longitude);
        if (nextLat != null && nextLng != null) {
            lat = nextLat;
            lng = nextLng;
        }
    }
    return ordered;
};

// ประเมินค่าพาหนะต่อขาจากระยะทางจริง — mirror ฝั่ง Flutter estimateTransportCost
// walking ฟรี, car 20/กม., bus 7/กม., train 12/กม., ferry 25/กม., flight 35/กม., อื่น ๆ 15/กม.
// km null/ไม่ finite → 0, ระยะสั้นกว่า 0.5 กม. → 50 ขั้นต่ำ, นอกนั้นปัดเศษพร้อมขั้นต่ำ 50
const estimateLegCostKm = (km, modeRaw) => {
    if (km == null) return 0;
    const distance = Number(km);
    if (!Number.isFinite(distance) || distance < 0) return 0;
    const mode = String(modeRaw || 'car').toLowerCase();
    if (mode === 'walking') return 0;
    if (distance < 0.5) return 50;
    const rates = {
        car: 20,
        bus: 7,
        train: 12,
        ferry: 25,
        flight: 35,
    };
    const rate = rates[mode] ?? 15;
    return Math.max(50, Math.round(distance * rate));
};

// เดินโซ่เวลา arrivalTime ต่อเนื่องทั้งวัน (mutate day):
// ถึง → เที่ยว durationMinutes → ออก → เดินทาง (segments นาทีจริง) → ถึงจุดถัดไป
// startMinutes คือเวลาออกเดินทาง (departure) — arrival จุดแรก = start + ขาแรกจาก origin
// origin { lat, lng, name, mode } ใช้คำนวณขาแรกจากจุดเริ่มต้นจริงเข้าจุดแรก
// ไม่มี origin: คงพฤติกรรมเดิม arrival0 = startMinutes (ยกเว้นสาขา preservation ข้างล่าง)
// คืนเวลาที่ใช้รวมของวัน + นาทีเดินทางรวม
const chainDayTimes = (day, startMinutes, origin) => {
    const stops = Array.isArray(day?.stops) ? day.stops : [];
    let cursor = startMinutes;
    let travelTotal = 0;
    // origin ใช้ได้เมื่อพิกัด origin ครบและจุดแรกมีพิกัดจริง
    const originLat = finiteCoord(origin?.lat ?? origin?.latitude);
    const originLng = finiteCoord(origin?.lng ?? origin?.longitude);
    const hasOriginCoords = originLat != null && originLng != null;
    stops.forEach((stop, index) => {
        if (!stop || typeof stop !== 'object') return;
        if (index === 0) {
            const firstLat = finiteCoord(stop.latitude);
            const firstLng = finiteCoord(stop.longitude);
            if (hasOriginCoords && firstLat != null && firstLng != null) {
                // ขาแรก: จุดเริ่มต้น → จุดแรก (departure semantics)
                const mode = String(stop.transportMode || origin?.mode || 'car').toLowerCase();
                const km = haversineKm(originLat, originLng, firstLat, firstLng);
                const { travelMinutes } = computeLegMinutes(km, mode);
                const cost = estimateLegCostKm(km, mode);
                const originName = String(origin?.name || '').trim() || 'จุดเริ่มต้น';
                stop.segments = [{
                    mode,
                    from: originName,
                    to: String(stop.place || ''),
                    estimatedMinutes: travelMinutes,
                    estimatedCost: cost,
                }];
                // ค่า AI ของจุดแรกมาจากไหนก็ไม่รู้ — เขียนทับด้วยขาจริงจาก origin
                stop.transportCost = cost;
                cursor += travelMinutes;
                travelTotal += travelMinutes;
            } else if (!hasOriginCoords) {
                // เส้น PUT/re-chain ไม่มี origin: คงขาแรกเดิมไว้กันเวลาขยับ
                const keptMinutes = Number(stop.segments?.[0]?.estimatedMinutes);
                if (Number.isFinite(keptMinutes) && keptMinutes > 0) {
                    cursor += keptMinutes;
                    travelTotal += keptMinutes;
                }
                // ไม่มีขาแรกเดิมก็ไม่แตะ segments จุดแรก (พฤติกรรมเดิม)
            }
        } else if (index > 0) {
            const prev = stops[index - 1] || {};
            const km = haversineKm(prev.latitude, prev.longitude, stop.latitude, stop.longitude);
            const mode = String(stop.transportMode || 'car').toLowerCase();
            const { travelMinutes, restMinutes: rawRestMinutes } = computeLegMinutes(km, mode);
            // ขาที่มีปลายข้างใดเป็นจุดพัก OSM มีเวลาพักจริง (durationMinutes 20) อยู่แล้ว —
            // ไม่บวกเวลาพักโดยประมาณซ้ำ ไม่งั้นจะนับพัก 2 รอบ (ทั้ง stop จริง + restMinutes)
            const isRestLeg = prev.isRestStop === true || stop.isRestStop === true
                || String(prev.destinationId ?? '').startsWith('osm:')
                || String(stop.destinationId ?? '').startsWith('osm:');
            const restMinutes = isRestLeg ? 0 : rawRestMinutes;
            const legTotal = travelMinutes + restMinutes;
            const keepCost = Number(stop.segments?.[0]?.estimatedCost);
            // ค่า leg จริงจากระยะทาง — คงค่า AI ที่เป็นบวกไว้ ไม่เขียนทับ (กันยอดรวมร่วง)
            const legCost = Number.isFinite(keepCost) && keepCost > 0
                ? keepCost
                : estimateLegCostKm(km, mode);
            stop.segments = [{
                mode,
                from: String(prev.place || ''),
                to: String(stop.place || ''),
                estimatedMinutes: legTotal,
                estimatedCost: legCost,
            }];
            const existingTransport = Number(stop.transportCost);
            stop.transportCost = Number.isFinite(existingTransport) && existingTransport > 0
                ? existingTransport
                : legCost;
            if (restMinutes > 0) stop.tip = appendRestNote(stop.tip, travelMinutes, restMinutes);
            cursor += legTotal;
            travelTotal += legTotal;
        }
        const duration = clampDurationMinutes(stop.durationMinutes);
        stop.durationMinutes = duration;
        stop.arrivalTime = formatClock(cursor);
        cursor += duration;
    });
    return { usedMinutes: cursor - startMinutes, travelMinutes: travelTotal };
};

// ประเมินจำนวนวันที่เหมาะสมจากสถานที่บังคับ + ระยะทางไกลสุดจากจุดเริ่มต้น
// (ใช้เมื่อผู้ใช้ไม่ได้กำหนดจำนวนวัน — frontend ส่ง auto_days หรือไม่ส่ง days มา)
const estimateRecommendedDays = ({ mustVisitCount = 0, maxDistanceKm = 0, placeCount = 0 } = {}) => {
    const must = Math.max(0, Number(mustVisitCount) || 0);
    const byStops = Math.max(1, Math.ceil(must / MAX_STOPS_PER_DAY));
    const distance = Number(maxDistanceKm) || 0;
    const byDistance = distance > 400 ? 3 : distance > 200 ? 2 : 1;
    const pool = Number(placeCount) || 0;
    const byVolume = must === 0 ? (pool >= 12 ? 3 : pool >= 8 ? 2 : 1) : 1;
    return {
        days: Math.min(7, Math.max(1, byStops, byDistance, byVolume)),
        maxDistanceKm: Math.round(distance),
    };
};

const maxDistanceFromStart = (startLat, startLng, places) => {
    const sLat = finiteCoord(startLat);
    const sLng = finiteCoord(startLng);
    if (sLat == null || sLng == null) return 0;
    let max = 0;
    for (const place of places || []) {
        const km = haversineKm(sLat, sLng, place?.latitude, place?.longitude);
        if (km != null && km > max) max = km;
    }
    return max;
};

// ตรวจว่าแต่ละวันแน่นเกินกรอบหรือไม่ (ไม่ mutate) — คืน warnings + เวลารวมทั้งทริป
const validateDayFit = (planData, { dayBudgetMinutes = DAY_BUDGET_MINUTES } = {}) => {
    const warnings = [];
    let totalUsedMinutes = 0;
    for (const day of planData?.days || []) {
        const stops = Array.isArray(day?.stops) ? day.stops : [];
        let used = 0;
        stops.forEach((stop) => {
            // นับขาแรกของจุดแรกด้วย (departure semantics: stop0.segments มีขาจาก origin)
            used += Number(stop?.segments?.[0]?.estimatedMinutes) || 0;
            used += Number(stop?.durationMinutes) || 0;
        });
        totalUsedMinutes += used;
        if (stops.length > 0 && used > dayBudgetMinutes) {
            warnings.push(
                `วันที่ ${day?.day ?? '?'} ต้องใช้ ~${(used / 60).toFixed(1)} ชม. ` +
                `เกินกรอบ ~${Math.round(dayBudgetMinutes / 60)} ชม./วัน — พิจารณาเพิ่มวันหรือลดสถานที่`,
            );
        }
    }
    return { warnings, totalUsedMinutes };
};

// เดินโซ่เวลาทุกวันโดยคงลำดับเดิมทุกจุด (ใช้ตอน PUT — เคารพลำดับที่ผู้ใช้จัดเอง)
// จุดแรก: arrival ที่เก็บไว้รวมขาแรกแล้ว จึงหักขาแรกออกเป็น departure ก่อนเดินโซ่ใหม่
// แล้ว chainDayTimes สาขา preservation จะคงขาแรกนั้นไว้ (เวลา/ราคาไม่ขยับ)
// คืน warnings ของวันที่แน่นเกินไป
const chainAllDaysPreservingOrder = (
    planData,
    { defaultStartMinutes = DEFAULT_DAY_START_MINUTES, dayBudgetMinutes = DAY_BUDGET_MINUTES } = {},
) => {
    for (const day of planData?.days || []) {
        const stops = Array.isArray(day?.stops) ? day.stops : [];
        if (stops.length === 0) continue;
        const arrival0 = parseClockToMinutes(stops[0]?.arrivalTime);
        const firstLegMinutes = Number(stops[0]?.segments?.[0]?.estimatedMinutes);
        // arrival0 รวมขาแรกแล้ว → หักออกได้ departure; ไม่มีขาแรกก็ใช้ arrival ตรง ๆ
        const departure = arrival0 != null && Number.isFinite(firstLegMinutes) && firstLegMinutes > 0
            ? arrival0 - firstLegMinutes
            : (arrival0 ?? defaultStartMinutes);
        chainDayTimes(day, departure);
    }
    return validateDayFit(planData, { dayBudgetMinutes }).warnings;
};

module.exports = {
    DAY_BUDGET_MINUTES,
    MAX_STOPS_PER_DAY,
    DEFAULT_DAY_START_MINUTES,
    parseClockToMinutes,
    parseStartTimeInput,
    formatClock,
    finiteCoord,
    haversineKm,
    computeLegMinutes,
    estimateLegCostKm,
    orderStopsNearestNeighbor,
    chainDayTimes,
    estimateRecommendedDays,
    maxDistanceFromStart,
    validateDayFit,
    chainAllDaysPreservingOrder,
};
