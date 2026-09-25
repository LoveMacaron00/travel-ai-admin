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
    bicycle: 15,
};

// เวลา overhead ต่อขา (รอเรือ/รถไฟ) — รวมในนาทีเดินทางเลย
const MODE_OVERHEAD_MINUTES = {
    walking: 0,
    car: 0,
    bus: 10,
    train: 30,
    ferry: 30,
    bicycle: 0,
};

// กรอบเวลาต่อวัน ~10 ชม. (เช่น 09:00–19:00) ใช้นับว่าแผนแน่นเกินไปหรือไม่
const DAY_BUDGET_MINUTES = 600;
const MAX_STOPS_PER_DAY = 5;
const DEFAULT_DAY_START_MINUTES = 9 * 60;

// กันเที่ยวดึก: ไม่จัดที่เที่ยวหลัง 21:00 และวันต้องจบไม่เกิน 22:00
const LATE_NIGHT_START_MINUTES = 21 * 60;
const DAY_HARD_END_MINUTES = 22 * 60;
const MAX_PLAN_DAYS = 7;

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

// "08:00" / "8:00" / "09:00:00" / "9:00 AM" / "08.00" → นาที, แปลงไม่ได้ → null
// "00:00" / "00:00 AM" ถือว่าไม่ระบุเวลา (หลายแถวใน DB ใช้ค่านี้เป็น unknown)
const parseTimeFlexible = (value) => {
    if (value == null) return null;
    let text = String(value).trim();
    if (!text || text === '00:00' || text === '00:00:00') return null;
    const ampm = text.match(/([AP])\.?\s*M\.?/i);
    // "08.30" → "08:30"
    text = text.replace(/(\d)\.(\d{2})/, '$1:$2');
    const match = text.match(/(\d{1,2})\s*[:.]\s*(\d{2})(?:\s*[:.]\s*\d{2})?/);
    if (!match) return null;
    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (minutes > 59) return null;
    if (ampm) {
        const isPm = ampm[1].toUpperCase() === 'P';
        if (hours < 1 || hours > 12) return null;
        if (isPm && hours !== 12) hours += 12;
        if (!isPm && hours === 12) hours = 0;
    } else if (hours > 23) {
        return null;
    }
    if (hours === 0 && minutes === 0) return null;
    return hours * 60 + minutes;
};

// ดึงกรอบเวลาเปิด-ปิดของสถานที่จากหลาย schema:
// opening_time/closing_time ("08:00"), opening_hours (array [{open,close}] หรือ string),
// tat_raw.openingHours / tat_raw เดิม — คืน {open, close} นาที หรือ null ถ้าไม่รู้
const getPlaceOpeningWindow = (place) => {
    if (!place || typeof place !== 'object') return null;
    const raw = place.tat_raw || place.tatRaw || null;
    let rawObj = null;
    if (typeof raw === 'string') {
        try { rawObj = JSON.parse(raw); } catch { rawObj = null; }
    } else if (raw && typeof raw === 'object') {
        rawObj = raw;
    }
    // 1) opening_time / closing_time ตรง ๆ
    const directOpen = parseTimeFlexible(place.opening_time ?? place.openingTime);
    const directClose = parseTimeFlexible(place.closing_time ?? place.closingTime);
    if (directOpen != null && directClose != null) return { open: directOpen, close: directClose };
    // 2) opening_hours array
    const list = place.opening_hours ?? place.openingHours ?? rawObj?.openingHours;
    if (Array.isArray(list) && list.length > 0) {
        const first = list[0] || {};
        const open = parseTimeFlexible(first.open ?? first.openTime ?? first.start ?? first.from);
        const close = parseTimeFlexible(first.close ?? first.closeTime ?? first.end ?? first.to);
        if (open != null && close != null) return { open, close };
        // บางแถวเก็บ description ข้อความ "09:00 - 18:00" ในช่องเดียว
        const desc = String(first.description ?? first.text ?? '').trim();
        if (desc) {
            const range = desc.match(/(\d{1,2}[:.]\d{2}[^0-9APM]*[-–—ถึง]+[^0-9]*\d{1,2}[:.]\d{2})/i);
            if (range) {
                const parts = range[1].split(/[-–—]/);
                const o = parseTimeFlexible(parts[0]);
                const c = parseTimeFlexible(parts[1]);
                if (o != null && c != null) return { open: o, close: c };
            }
        }
    } else if (typeof list === 'string' && list.trim()) {
        const range = list.match(/(\d{1,2}[:.]\d{2})\s*[-–—]\s*(\d{1,2}[:.]\d{2})/);
        if (range) {
            const o = parseTimeFlexible(range[1]);
            const c = parseTimeFlexible(range[2]);
            if (o != null && c != null) return { open: o, close: c };
        }
    }
    // 3) tat_raw.information / detail อาจมีเวลาฝังอยู่ — fallback แบบ best-effort
    if (rawObj) {
        const candidates = [
            rawObj?.information?.openTime, rawObj?.information?.closeTime,
            rawObj?.openTime, rawObj?.closeTime,
        ];
        const o = parseTimeFlexible(candidates[0]);
        const c = parseTimeFlexible(candidates[1]);
        if (o != null && c != null) return { open: o, close: c };
    }
    // 4) มีข้างเดียว (เช่น รู้แค่เปิด) — ถือว่าไม่พอตรวจ
    return null;
};

// ตรวจว่าช่วงเที่ยว [arrival, departure) อยู่ในเวลาเปิด-ปิดไหม
// รองรับร้านข้ามคืน (close < open เช่น 18:00-02:00) และเผื่อเวลา 15 นาทีให้เดินออก
// ไม่รู้เวลาเปิด (null) → ถือว่าผ่าน (ไม่บล็อก)
const isWithinOpeningHours = (arrivalMinutes, departureMinutes, window) => {
    if (!window || window.open == null || window.close == null) return true;
    const arrival = ((Math.round(arrivalMinutes) % 1440) + 1440) % 1440;
    const departure = ((Math.round(departureMinutes) % 1440) + 1440) % 1440;
    const { open, close } = window;
    if (close === open) return true;
    const crossMidnight = close < open;
    if (!crossMidnight) {
        return arrival >= open && arrival < close && departure <= close + 15;
    }
    // ข้ามคืน: เปิด 18:00 ปิด 02:00 → ช่วง [open,1440) ∪ [0,close]
    const inOpen = (t) => t >= open || t < close;
    return inOpen(arrival) && (inOpen(departure) || departure <= close + 15);
};

// จุดนี้ถือว่า "เที่ยวดึก" ไหม — ที่เที่ยวที่ถึง ≥21:00
// หรือออกเกิน 22:00 หรือโผล่ช่วง 00:00-05:00 (formatClock วนรอบเที่ยงคืนแล้ว)
const isLateNightVisit = (stop, arrivalMinutes, departureMinutes) => {
    if (!stop || typeof stop !== 'object') return false;
    const arrival = ((Math.round(arrivalMinutes) % 1440) + 1440) % 1440;
    const departure = ((Math.round(departureMinutes) % 1440) + 1440) % 1440;
    if (arrival >= LATE_NIGHT_START_MINUTES) return true;
    if (departure > DAY_HARD_END_MINUTES && departure < 12 * 60) return true;
    if (arrival < 5 * 60) return true;
    return false;
};

const finiteCoord = (value) => {
    // null/undefined/'' คือ "ไม่ได้ส่งพิกัดมา" — ต้องคืน null ไม่ใช่ 0
    // (Number(null) === 0 ถ้าปล่อยผ่าน origin จะกลายเป็น (0,0) กลางมหาสมุทร
    // แล้วขาแรกของวันแรกจะยาว ~11,000 กม. (~222 ชม.) ยอดรวมพังทั้งทริป)
    if (value == null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

// normalize ชื่อไทย/อังกฤษสำหรับเทียบ (ตัดอักขระพิเศษ + lowercase)
// ใช้ร่วมกันหลายไฟล์ (planPlaceNormalizer/aiHelper/ที่นี่) แทนนิยามซ้ำ regex เดียวกัน
const normalizeThaiName = (value) => String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('th')
    .replace(/[^\p{L}\p{N}]+/gu, '');

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
    if (['car', 'bus', 'train', 'bicycle'].includes(mode) && travelMinutes >= 120) {
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
// car = รถยนต์ส่วนตัว คิดค่าน้ำมัน ~3 บาท/กม. ไม่มีขั้นต่ำ (ไม่มีเรทแท็กซี่)
// walking/bicycle ฟรี (รถ/จักรยานตัวเอง), bus 7/กม., train 12/กม., ferry 25/กม., อื่น ๆ 15/กม.
// km null/ไม่ finite → 0, รถอื่นระยะสั้นกว่า 0.5 กม. → 50 ขั้นต่ำ, นอกนั้นปัดเศษพร้อมขั้นต่ำ 50
const estimateLegCostKm = (km, modeRaw) => {
    if (km == null) return 0;
    const distance = Number(km);
    if (!Number.isFinite(distance) || distance < 0) return 0;
    const mode = String(modeRaw || 'car').toLowerCase();
    if (mode === 'walking' || mode === 'bicycle') return 0;
    if (mode === 'car') return estimateFuelCostKm(distance);
    if (distance < 0.5) return 50;
    const rates = { bus: 7, train: 12, ferry: 25 };
    const rate = rates[mode] ?? 15;
    return Math.max(50, Math.round(distance * rate));
};

// รถยนต์ส่วนตัวทุกทริป: คิดแค่ค่าน้ำมันตามระยะจริง
// (~3 บาท/กม. ≈ น้ำมัน 36 บาท/ลิตร ÷ 12 กม./ลิตร) — ไม่มีเรทแท็กซี่แล้ว
const LOCAL_FUEL_RATE_PER_KM = 3;

const estimateFuelCostKm = (km) => {
    const distance = Number(km);
    if (!Number.isFinite(distance) || distance < 0) return 0;
    return Math.round(distance * LOCAL_FUEL_RATE_PER_KM);
};

// รถยนต์ส่วนตัว: เหมาค่าน้ำมันทั้งวันไว้ที่ขารถขาแรกของวัน (mutate planData)
// ระยะแต่ละขาคำนวณจากพิกัดจริงด้วยสูตรเดียวกับ chainDayTimes
// (วันแรกจากจุดเริ่ม, วันถัดไปจากจุดสุดท้ายของวันก่อน) — เปลี่ยนแค่ "ราคา" ไม่แตะเวลา
// ขารถขาอื่นของวันเป็น 0 (เหมาแล้ว), ขาไม่ใช่รถยนต์คงเดิม, ขาหาพิกัดไม่ได้คงเดิม
const applyCarFuelCosts = (planData, { startLat, startLng } = {}) => {
    if (!planData || typeof planData !== 'object') return { saved: 0 };
    const days = Array.isArray(planData.days) ? planData.days : [];
    if (days.length === 0) return { saved: 0 };
    let saved = 0;
    let prevLat = finiteCoord(startLat);
    let prevLng = finiteCoord(startLng);
    for (const day of days) {
        const stops = Array.isArray(day?.stops) ? day.stops : [];
        const carLegs = [];
        for (let i = 0; i < stops.length; i++) {
            const stop = stops[i];
            if (!stop || typeof stop !== 'object') continue;
            if (String(stop.transportMode || 'car').toLowerCase() !== 'car') continue;
            let fromLat;
            let fromLng;
            if (i === 0) {
                if (prevLat == null || prevLng == null) continue;
                fromLat = prevLat;
                fromLng = prevLng;
            } else {
                fromLat = finiteCoord(stops[i - 1]?.latitude);
                fromLng = finiteCoord(stops[i - 1]?.longitude);
                if (fromLat == null || fromLng == null) continue;
            }
            const toLat = finiteCoord(stop.latitude);
            const toLng = finiteCoord(stop.longitude);
            if (toLat == null || toLng == null) continue;
            const km = haversineKm(fromLat, fromLng, toLat, toLng);
            if (km == null) continue;
            carLegs.push({ stop, fuel: estimateFuelCostKm(km) });
        }
        // เหมาวัน: ขารถขาแรกรับยอดรวมทั้งวัน ขารถขาอื่นเป็น 0 (ยอดรวมเท่าเดิมแค่ย้ายที่โชว์)
        const dayFuel = carLegs.reduce((sum, leg) => sum + leg.fuel, 0);
        carLegs.forEach(({ stop }, legIndex) => {
            const assigned = legIndex === 0 ? dayFuel : 0;
            const oldCost = Number(stop.transportCost) || 0;
            saved += oldCost - assigned;
            stop.transportCost = assigned;
            if (Array.isArray(stop.segments) && stop.segments[0]
                && String(stop.segments[0].mode || 'car').toLowerCase() === 'car') {
                stop.segments[0].estimatedCost = assigned;
            }
        });
        const last = stops[stops.length - 1];
        const lastLat = finiteCoord(last?.latitude);
        const lastLng = finiteCoord(last?.longitude);
        if (lastLat != null && lastLng != null) {
            prevLat = lastLat;
            prevLng = lastLng;
        }
    }
    if (saved !== 0) {
        const total = Number(planData.totalEstimatedCost);
        planData.totalEstimatedCost = Math.max(
            0, (Number.isFinite(total) ? total : 0) - saved);
        if (planData.budgetBreakdown && typeof planData.budgetBreakdown === 'object') {
            const transport = Number(planData.budgetBreakdown.transport);
            planData.budgetBreakdown.transport = Math.max(
                0, (Number.isFinite(transport) ? transport : 0) - saved);
        }
    }
    return { saved };
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
            const { travelMinutes, restMinutes } = computeLegMinutes(km, mode);
            const legTotal = travelMinutes + restMinutes;
            // เดิน/ปั่นจักรยานของตัวเองฟรีเสมอ — ล้างค่า AI ที่อาจใส่มา (กันยอด transport มีค่าฟรี)
            const isFreeMode = mode === 'walking' || mode === 'bicycle';
            const keepCost = Number(stop.segments?.[0]?.estimatedCost);
            // ค่า leg จริงจากระยะทาง — คงค่า AI ที่เป็นบวกไว้ ไม่เขียนทับ (กันยอดรวมร่วง)
            const legCost = isFreeMode
                ? 0
                : Number.isFinite(keepCost) && keepCost > 0
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
            stop.transportCost = isFreeMode
                ? 0
                : Number.isFinite(existingTransport) && existingTransport > 0
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

// สร้าง map id → place + name-normalized สำหรับตรวจเวลาเปิด-ปิด
const buildPlacesById = (places) => {
    const byId = new Map();
    const byName = new Map();
    for (const place of places || []) {
        if (!place || typeof place !== 'object') continue;
        const id = String(place.id ?? '').trim();
        if (id) byId.set(id, place);
        const nameKey = normalizeThaiName(place.name);
        if (nameKey) byName.set(nameKey, place);
    }
    return { byId, byName };
};

const findPlaceForStop = (stop, index) => {
    const { byId, byName } = index || {};
    if (!stop || typeof stop !== 'object') return null;
    const id = String(stop.destinationId ?? '').trim();
    if (id && byId && byId.has(id)) return byId.get(id);
    const key = normalizeThaiName(stop.place);
    if (key && byName && byName.has(key)) return byName.get(key);
    return null;
};

// หยิบกรอบเวลาเปิด-ปิดของ stop — ค่าติด stop มาก่อน แล้วค่อยค้นจาก DB
const getStopOpeningWindow = (stop, index) => {
    const stopOpen = parseTimeFlexible(stop?.openingTime ?? stop?.opening_time);
    const stopClose = parseTimeFlexible(stop?.closingTime ?? stop?.closing_time);
    if (stopOpen != null && stopClose != null) return { open: stopOpen, close: stopClose };
    const place = findPlaceForStop(stop, index);
    return place ? getPlaceOpeningWindow(place) : null;
};

// หยิบวันเปิดทำการของ stop ([1..7] จันทร์..อาทิตย์ ตรงกับ Dart DateTime.weekday)
// ว่าง/ครบทั้งสัปดาห์ = ไม่จำกัด → คืน null
const getStopOpenDays = (stop) => {
    const raw = stop?.openDays;
    if (!Array.isArray(raw)) return null;
    const days = [...new Set(raw.map(Number).filter(
        (d) => Number.isInteger(d) && d >= 1 && d <= 7,
    ))].sort((a, b) => a - b);
    if (days.length === 0 || days.length === 7) return null;
    return days;
};

// ชื่อวันแบบย่อภาษาไทยสำหรับข้อความเตือน ("ส–อา", "จ,พ,ศ")
const TH_DAY_SHORT = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];
const formatOpenDaysShort = (days) => {
    const sorted = [...days].sort((a, b) => a - b);
    let contiguous = sorted.length > 1;
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] !== sorted[i - 1] + 1) {
            contiguous = false;
            break;
        }
    }
    if (contiguous) return `${TH_DAY_SHORT[sorted[0] - 1]}–${TH_DAY_SHORT[sorted[sorted.length - 1] - 1]}`;
    return sorted.map((d) => TH_DAY_SHORT[d - 1]).join(',');
};

// "YYYY-MM-DD" → Date (date-only) — ใช้ไม่ได้คืน null (ไม่มีวันเริ่ม = ไม่ตรวจวันเปิด)
const parseTripStartDate = (value) => {
    const match = String(value || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
        return null;
    }
    if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
        return null;
    }
    return new Date(year, month - 1, day);
};

// วันที่จริงของ dayIndex (0-based) = วันเริ่มทริป + index — ไม่มีวันเริ่มคืน null
const dayDateOfTrip = (startDate, dayIndex) => {
    const start = parseTripStartDate(startDate);
    if (start == null) return null;
    return new Date(start.getFullYear(), start.getMonth(), start.getDate() + dayIndex);
};

// weekday 1..7 (จันทร์..อาทิตย์ ตรงกับ Dart) — Date.getDay() อาทิตย์ = 0
const weekdayOf = (date) => {
    const js = date.getDay();
    return js === 0 ? 7 : js;
};

// นับจุดในวันนี้ที่ปิดทำการ (ไม่ mutate) — ต้องรู้วันที่ ไม่มีวัน/ไม่มีข้อมูลวันข้าม
const countDayClosedViolations = (day, dayDate) => {
    if (!(dayDate instanceof Date) || Number.isNaN(dayDate.getTime())) return 0;
    const weekday = weekdayOf(dayDate);
    let count = 0;
    for (const stop of day?.stops || []) {
        if (!stop || typeof stop !== 'object') continue;
        const openDays = getStopOpenDays(stop);
        if (openDays && !openDays.includes(weekday)) count++;
    }
    return count;
};

// นับจุดในวันนี้ที่เที่ยวอยู่นอกเวลาเปิด-ปิด (ไม่ mutate) — ไม่รู้เวลาเปิดถือว่าผ่าน
const countDayOpeningViolations = (day, index) => {
    const stops = Array.isArray(day?.stops) ? day.stops : [];
    let count = 0;
    for (const stop of stops) {
        if (!stop || typeof stop !== 'object') continue;
        const arrival = parseClockToMinutes(stop.arrivalTime);
        if (arrival == null) continue;
        const departure = arrival + clampDurationMinutes(stop.durationMinutes);
        const window = getStopOpeningWindow(stop, index);
        if (window && !isWithinOpeningHours(arrival, departure, window)) count++;
    }
    return count;
};

// นับจุดเที่ยวดึกในวันนี้ (ไม่ mutate) — ใช้กันซ่อมเวลาเปิดแล้วทำเที่ยวดึกเพิ่ม
const countDayLateNight = (day) => {
    const stops = Array.isArray(day?.stops) ? day.stops : [];
    let count = 0;
    for (const stop of stops) {
        if (!stop || typeof stop !== 'object') continue;
        const arrival = parseClockToMinutes(stop.arrivalTime);
        if (arrival == null) continue;
        if (isLateNightVisit(stop, arrival, arrival + clampDurationMinutes(stop.durationMinutes))) {
            count++;
        }
    }
    return count;
};

// ตรวจเวลาเปิด-ปิด + เที่ยวดึกทั้งแผน (ไม่ mutate)
// - เที่ยวดึก: ที่เที่ยวที่ถึง ≥21:00 / ออกเกิน 22:00 / ช่วง 00:00-05:00
// - เปิด-ปิด: เทียบ arrival→departure กับ opening_time/closing_time/opening_hours ใน DB
//   (stop ที่พก openingTime/closingTime มาด้วยใช้ค่าของตัวเองก่อน — ใช้ตอน PUT ที่ไม่มี places)
// คืน warnings ภาษาไทย (dedup ฝั่ง caller)
const validateOpeningAndLateNight = (planData, places = [], {
    lateNightStart = LATE_NIGHT_START_MINUTES,
    hardEnd = DAY_HARD_END_MINUTES,
    startDate = null,
} = {}) => {
    const warnings = [];
    const index = buildPlacesById(places);
    const days = Array.isArray(planData?.days) ? planData.days : [];
    for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
        const day = days[dayIndex];
        const stops = Array.isArray(day?.stops) ? day.stops : [];
        const dayDate = startDate != null ? dayDateOfTrip(startDate, dayIndex) : null;
        const dayWeekday = dayDate != null ? weekdayOf(dayDate) : null;
        for (const stop of stops) {
            if (!stop || typeof stop !== 'object') continue;
            // 0) ปิดทำการวันนี้ (เช่น ถนนคนเดินเปิดแค่เสาร์-อาทิตย์) — สำคัญสุด ข้ามเช็กอื่น
            if (dayWeekday != null) {
                const openDays = getStopOpenDays(stop);
                if (openDays && !openDays.includes(dayWeekday)) {
                    warnings.push(
                        `วันที่ ${day?.day ?? '?'}: “${stop.place || 'ไม่ทราบชื่อ'}” ` +
                        `ปิดวันนี้ (เปิดเฉพาะ ${formatOpenDaysShort(openDays)}) ` +
                        `— ควรย้ายไปวันที่เปิดทำการ`,
                    );
                    continue;
                }
            }
            const arrival = parseClockToMinutes(stop.arrivalTime);
            if (arrival == null) continue;
            const duration = clampDurationMinutes(stop.durationMinutes);
            const departure = arrival + duration;
            // 1) เที่ยวดึกก่อน — สำคัญสุด (ผู้ใช้บ่นจากภาพ 23:09 / 00:45 / 03:21)
            if (isLateNightVisit(stop, arrival, departure)) {
                const leave = formatClock(departure);
                warnings.push(
                    `วันที่ ${day?.day ?? '?'}: “${stop.place || 'ไม่ทราบชื่อ'}” ` +
                    `ถึง ${stop.arrivalTime} ออก ${leave} — ดึกเกินไป (ปกติเที่ยวถึง ~21:00) ` +
                    `ควรย้ายไปวันอื่นหรือเพิ่มวัน`,
                );
                continue;
            }
            // 2) เวลาเปิด-ปิด
            const window = getStopOpeningWindow(stop, index);
            if (window && !isWithinOpeningHours(arrival, departure, window)) {
                const fmt = (m) => formatClock(m);
                warnings.push(
                    `วันที่ ${day?.day ?? '?'}: “${stop.place || 'ไม่ทราบชื่อ'}” ` +
                    `ถึง ${stop.arrivalTime} (ออก ${fmt(departure)}) ` +
                    `อาจอยู่นอกเวลาเปิด-ปิด ${fmt(window.open)}–${fmt(window.close)} ` +
                    `— ควรเลื่อนไปช่วงกลางวันหรือตรวจสอบกับสถานที่อีกครั้ง`,
                );
            }
        }
    }
    return warnings;
};

// เกลี่ยวันที่ล้นไปวันถัดไปกันเที่ยวดึก (mutate planData)
// กติกา: อ่าน arrivalTime ที่ chain ไว้แล้วทีละจุด (รองรับค่าข้ามเที่ยงคืนแบบ 23:09→00:45
// โดยบวก 1440 เมื่อนาฬิกาย้อนกลับ); ถ้าจุดเที่ยวถึง ≥21:00 / ออกเกิน 22:00 / ช่วง 00:00-05:00
// ให้ย้ายจุดนั้น + ที่เหลือไปวันถัดไป
// (สร้างวันใหม่สูงสุด 7 วัน) วันเดิมเดินโซ่ใหม่คงเวลาเดิม วันใหม่เริ่ม 09:00 ใหม่
// คืน {moved, createdDays}
const splitOverflowingDays = (planData, {
    startMinutes = DEFAULT_DAY_START_MINUTES,
    lateNightStart = LATE_NIGHT_START_MINUTES,
    hardEnd = DAY_HARD_END_MINUTES,
    maxDays = MAX_PLAN_DAYS,
} = {}) => {
    if (!planData || typeof planData !== 'object') return { moved: 0, createdDays: 0 };
    if (!Array.isArray(planData.days)) return { moved: 0, createdDays: 0 };
    let moved = 0;
    let createdDays = 0;
    let dayIndex = 0;
    // กัน loop ไม่รู้จบเมื่อย้ายจุดเดียวซ้ำ ๆ
    let guard = 0;
    while (dayIndex < planData.days.length && guard < 30) {
        guard++;
        const day = planData.days[dayIndex];
        const stops = Array.isArray(day?.stops) ? day.stops : [];
        if (stops.length === 0) { dayIndex++; continue; }
        let splitAt = -1;
        for (let i = 0; i < stops.length; i++) {
            const stop = stops[i];
            if (!stop || typeof stop !== 'object') continue;
            // ใช้ arrivalTime ที่ chain ไว้แล้วตรง ๆ (23:09 / 00:45 ก็ตรวจว่าดึกได้เลย
            // ไม่ต้องบวก offset ข้ามคืน — isLateNightVisit ดูนาฬิกา 0-1439 อยู่แล้ว)
            const clock = parseClockToMinutes(stop.arrivalTime);
            if (clock == null) continue;
            const duration = clampDurationMinutes(stop.durationMinutes);
            const departure = clock + duration;
            const tooLate = isLateNightVisit(stop, clock, departure);
            // ต้องเหลืออย่างน้อย 1 ที่เที่ยวไว้ในวันนี้ กันย้ายทั้งวัน
            if (tooLate && i > 0) { splitAt = i; break; }
            // จุดแรกของวันก็ดึกเอง (เช่น ขาแรก 417 นาทีจากต่างจังหวัดมาถึง 23:09)
            // ย้ายไม่ได้เพราะ i==0 — ปล่อยให้ warnings เตือน + caller เลื่อน start/เพิ่มวันแทน
        }
        if (splitAt === -1) { dayIndex++; continue; }
        // ย้าย stops[splitAt..] ไปวันถัดไป
        const overflow = stops.splice(splitAt);
        moved += overflow.length;
        let nextDay = planData.days[dayIndex + 1];
        if (!nextDay) {
            if (planData.days.length >= maxDays) {
                // เต็ม 7 วันแล้ว — คืนของกลับ (ทำได้แค่เตือน)
                stops.push(...overflow);
                moved -= overflow.length;
                dayIndex++;
                continue;
            }
            nextDay = { day: planData.days.length + 1, theme: 'ต่อจากวันก่อน', stops: [] };
            planData.days.push(nextDay);
            createdDays++;
        }
        nextDay.stops = [...overflow, ...(Array.isArray(nextDay.stops) ? nextDay.stops : [])];
        // วันเดิม: เดินโซ่ใหม่คงเวลาเดิม (departure จาก arrival0 - ขาแรก)
        chainAllDaysPreservingOrder({ days: [day] }, { defaultStartMinutes: startMinutes });
        // วันใหม่: เริ่มเช้าใหม่ที่ startMinutes (ไม่คงเวลาดึกเดิม)
        chainDayTimes(nextDay, startMinutes);
        // ตรวจวันนี้ใหม่ (อาจยังล้นถ้าจุดเดียวยาวมาก) — ไม่เลื่อน dayIndex
    }
    // เรียงเลขวันใหม่ 1..N กันเลขกระโดด
    planData.days.forEach((d, i) => { if (d && typeof d === 'object') d.day = i + 1; });
    return { moved, createdDays };
};

// ซ่อมจุดที่หลุดเวลาเปิด-ปิดด้วยการลองสลับลำดับภายในวันเดียวกัน (mutate planData)
// วิธี: ล้างขาเข้าเก่าทิ้ง เดินโซ่ใหม่ แล้วลองย้ายทีละจุดไปทุกตำแหน่ง นับ violation ใหม่
// รับเฉพาะท่าที่ลดจำนวนลงและไม่เพิ่มเที่ยวดึก — ซ่อมไม่ได้คงลำดับเดิมไว้
// ไม่มี origin (เช่น ทริปล่วงหน้าไม่ส่งพิกัดเริ่ม) จุดแรกเริ่ม startMinutes ตรง ๆ แล้วเทียบแบบสัมพัทธ์
// ใช้เฉพาะตอนสร้างแผน (PUT เคารพลำดับที่ผู้ใช้จัดเอง ห้ามสลับ)
// คืน { fixed (จุดที่หลุดน้อยลง) }
const repairDayOpeningOrder = (planData, places = [], {
    startLat,
    startLng,
    startMinutes = DEFAULT_DAY_START_MINUTES,
    primaryMode = 'car',
    startDate = null,
} = {}) => {
    if (!planData || typeof planData !== 'object') return { fixed: 0 };
    const days = Array.isArray(planData.days) ? planData.days : [];
    if (days.length === 0) return { fixed: 0 };
    const index = buildPlacesById(places);
    let fixed = 0;
    let prevLat = finiteCoord(startLat);
    let prevLng = finiteCoord(startLng);
    let prevName = 'จุดเริ่มต้น';
    let prevMode = String(primaryMode || 'car').toLowerCase();
    for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
        const day = days[dayIndex];
        // วันที่จริงของวันนี้ (ถ้ารู้วันเริ่มทริป) — ใช้ตรวจที่ปิดทำการประจำวัน
        const dayDate = startDate != null ? dayDateOfTrip(startDate, dayIndex) : null;
        const stops = Array.isArray(day?.stops) ? day.stops : [];
        // origin วันนี้ (เหมือน applyDeterministicSchedule): วันแรกจากจุดเริ่ม วันถัดไปจากจุดสุดท้ายวันก่อน
        const origin = (prevLat != null && prevLng != null)
            ? { lat: prevLat, lng: prevLng, name: prevName, mode: prevMode }
            : undefined;
        // จดจุดสุดท้ายของวัน (หลังซ่อม) ไว้เป็น origin ให้วันถัดไป
        const advancePrev = () => {
            const current = Array.isArray(day?.stops) ? day.stops : [];
            const tail = current[current.length - 1];
            const tailLat = finiteCoord(tail?.latitude);
            const tailLng = finiteCoord(tail?.longitude);
            if (tailLat != null && tailLng != null) {
                prevLat = tailLat;
                prevLng = tailLng;
                prevName = String(tail?.place || '').trim() || prevName;
                prevMode = String(tail?.transportMode || prevMode || 'car').toLowerCase();
            } else {
                prevLat = null;
                prevLng = null;
            }
        };
        if (stops.length < 2) {
            advancePrev();
            continue;
        }
        // ล้างขาเข้าเก่าทิ้งก่อน — กันเวลาค้างตามลำดับเดิมกวนผลเปรียบเทียบ
        // มี origin ขาแรกคำนวณจาก origin, ไม่มี origin จุดแรกเริ่ม startMinutes ตรง ๆ
        for (const stop of stops) {
            if (stop && typeof stop === 'object') stop.segments = [];
        }
        chainDayTimes(day, startMinutes, origin);
        const original = [...day.stops];
        // คะแนนรวม = หลุดเวลาเปิด + ปิดทำการวันนี้ (สลับในวันแก้วันปิดไม่ได้ แต่กันไม่ให้แย่ลง)
        const baseOpening = countDayOpeningViolations(day, index);
        const baseClosed = countDayClosedViolations(day, dayDate);
        const baseScore = baseOpening + baseClosed;
        if (baseScore === 0) {
            advancePrev();
            continue;
        }
        const baseLate = countDayLateNight(day);
        let best = null;
        for (let i = 0; i < original.length && (best == null || best.score > 0); i++) {
            for (let j = 0; j < original.length; j++) {
                if (i === j) continue;
                const trial = [...original];
                const [moved] = trial.splice(i, 1);
                trial.splice(j, 0, moved);
                day.stops = trial;
                chainDayTimes(day, startMinutes, origin);
                const opening = countDayOpeningViolations(day, index);
                const closed = countDayClosedViolations(day, dayDate);
                const late = countDayLateNight(day);
                // รับเฉพาะท่าที่ดีขึ้นจริงและไม่สร้างเที่ยวดึกเพิ่ม
                if (opening + closed < baseScore && late <= baseLate
                    && (best == null || opening + closed < best.score)) {
                    best = { order: [...trial], score: opening + closed };
                    if (opening + closed === 0) break;
                }
            }
        }
        if (best != null) {
            day.stops = best.order;
            chainDayTimes(day, startMinutes, origin);
            fixed += baseScore - best.score;
        } else {
            // ซ่อมไม่ได้ — คืนลำดับเดิมแล้วเดินโซ่ใหม่ให้เวลาตรงเหมือนก่อนลอง
            day.stops = original;
            chainDayTimes(day, startMinutes, origin);
        }
        advancePrev();
    }
    if (fixed > 0) {
        planData.tips = Array.isArray(planData.tips) ? planData.tips : [];
        const note = `จัดลำดับใหม่ ${fixed} จุดให้ตรงเวลาเปิด-ปิดของสถานที่แล้ว`;
        if (!planData.tips.includes(note)) planData.tips.push(note);
    }
    return { fixed };
};

// ลบจุดแวะพัก/ปั๊ม/ที่พัก/สนามบินตกค้างของแผนเก่า (rest/overnight/transfer/osm:) + ปรับงบตามยอดที่ตัด
// ใช้ตอนอ่านแผนเก่าจาก DB (in-memory ไม่เขียนกลับ) — แผนใหม่ไม่มี stop พวกนี้แล้ว
// คืนจำนวน stop ที่ตัดออก (0 = ไม่มีอะไรให้ตัด คง planData เดิม)
const stripLegacyLodgingAndRestStops = (planData) => {
    if (!planData || typeof planData !== 'object' || !Array.isArray(planData.days)) return 0;
    const isLegacyLodgingOrRest = (stop) => {
        if (!stop || typeof stop !== 'object') return false;
        return stop.stopType === 'overnight' || stop.stopType === 'rest'
            || stop.stopType === 'transfer'
            || stop.isRestStop === true
            || String(stop.destinationId ?? '').startsWith('osm:')
            || String(stop.destinationId ?? '').startsWith('curated:');
    };
    let removed = 0;
    let removedTransport = 0;
    let removedFood = 0;
    let removedEntry = 0;
    for (const day of planData.days) {
        const stops = Array.isArray(day?.stops) ? day.stops : [];
        const kept = [];
        for (const stop of stops) {
            if (isLegacyLodgingOrRest(stop)) {
                removed++;
                removedTransport += Number(stop.transportCost) || 0;
                removedFood += Number(stop.foodCost) || 0;
                removedEntry += Number(stop.entryCost) || 0;
            } else {
                kept.push(stop);
            }
        }
        day.stops = kept;
    }
    if (removed === 0) return 0;
    const nonNegative = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
    // ผลรวมของ stop ที่เหลือ — ใช้ประมาณยอดเดิม (ที่เหลือ + ที่ตัด) เมื่อ breakdown หาย/ไม่ตรง
    const sumKept = (pick) => {
        let sum = 0;
        for (const day of planData.days) {
            for (const stop of day?.stops || []) sum += Number(pick(stop)) || 0;
        }
        return sum;
    };
    if (!planData.budgetBreakdown || typeof planData.budgetBreakdown !== 'object') {
        planData.budgetBreakdown = {};
    }
    const breakdown = planData.budgetBreakdown;
    const transportBase = Number.isFinite(Number(breakdown.transport))
        ? Number(breakdown.transport)
        : sumKept((s) => s.transportCost) + removedTransport;
    const foodBase = Number.isFinite(Number(breakdown.food))
        ? Number(breakdown.food)
        : sumKept((s) => s.foodCost) + removedFood;
    const activitiesBase = Number.isFinite(Number(breakdown.activities))
        ? Number(breakdown.activities)
        : sumKept((s) => s.entryCost) + removedEntry;
    breakdown.transport = nonNegative(transportBase - removedTransport);
    breakdown.food = nonNegative(foodBase - removedFood);
    breakdown.activities = nonNegative(activitiesBase - removedEntry);
    // ไม่มีที่พักแล้ว หมวดโรงแรมไม่มีความหมาย — ลบทิ้งเสมอ
    delete breakdown.accommodation;
    delete breakdown.hotel;
    const total = Number(planData.totalEstimatedCost);
    planData.totalEstimatedCost = nonNegative(
        (Number.isFinite(total) ? total : transportBase + foodBase + activitiesBase)
        - removedTransport - removedFood - removedEntry,
    );
    return removed;
};

// เดินโซ่เวลาทุกวันโดยคงลำดับเดิมทุกจุด (ใช้ตอน PUT — เคารพลำดับที่ผู้ใช้จัดเอง)
// จุดแรก: arrival ที่เก็บไว้รวมขาแรกแล้ว จึงหักขาแรกออกเป็น departure ก่อนเดินโซ่ใหม่
// แล้ว chainDayTimes สาขา preservation จะคงขาแรกนั้นไว้ (เวลา/ราคาไม่ขยับ)
// คืน warnings ของวันที่แน่น + เที่ยวดึก/นอกเวลาเปิด-ปิด (ถ้าส่ง places มาจะตรวจเปิด-ปิดด้วย)
const chainAllDaysPreservingOrder = (
    planData,
    { defaultStartMinutes = DEFAULT_DAY_START_MINUTES, dayBudgetMinutes = DAY_BUDGET_MINUTES, places = null, startDate = null } = {},
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
    const warnings = validateDayFit(planData, { dayBudgetMinutes }).warnings;
    const timeWarnings = validateOpeningAndLateNight(planData, places || [], { startDate });
    return [...warnings, ...timeWarnings];
};

module.exports = {
    DAY_BUDGET_MINUTES,
    MAX_STOPS_PER_DAY,
    DEFAULT_DAY_START_MINUTES,
    LATE_NIGHT_START_MINUTES,
    DAY_HARD_END_MINUTES,
    MAX_PLAN_DAYS,
    LOCAL_FUEL_RATE_PER_KM,
    parseClockToMinutes,
    parseStartTimeInput,
    parseTimeFlexible,
    formatClock,
    getPlaceOpeningWindow,
    getStopOpeningWindow,
    getStopOpenDays,
    countDayClosedViolations,
    buildPlacesById,
    findPlaceForStop,
    isWithinOpeningHours,
    isLateNightVisit,
    finiteCoord,
    normalizeThaiName,
    haversineKm,
    computeLegMinutes,
    estimateLegCostKm,
    estimateFuelCostKm,
    applyCarFuelCosts,
    orderStopsNearestNeighbor,
    chainDayTimes,
    estimateRecommendedDays,
    maxDistanceFromStart,
    validateDayFit,
    validateOpeningAndLateNight,
    splitOverflowingDays,
    repairDayOpeningOrder,
    stripLegacyLodgingAndRestStops,
    chainAllDaysPreservingOrder,
};
