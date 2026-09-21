// server/controllers/tripController.js

const pool = require('../config/db');
const { generateTripPlan } = require('../services/aiHelper');
const {
    normalizePlanPlaces,
    sanitizePlaceholderPlanImages,
} = require('../utils/planPlaceNormalizer');
const {
    parseStartTimeInput,
    chainAllDaysPreservingOrder,
    downgradeShortFlights,
    markRentalCarLegs,
    applyTransportDelta,
} = require('../utils/planScheduler');
const { computeReturnLeg } = require('../services/restStopService');
const tripRepository = require('../repositories/tripRepository');

const normalizeStoredPlan = (planData, places) => {
    normalizePlanPlaces(planData, places);
    sanitizePlaceholderPlanImages(planData);
};

// คำนวณขากลับใหม่ทุกครั้ง (มากลับรถ=ขับกลับ / มาเครื่องบิน=รถเช่าไปสนามบิน+บินกลับ)
// ปรับยอดด้วยผลต่างจากขากลับเดิม (หักของเก่าออกก่อนบวกของใหม่ กันนับซ้ำ)
// ใช้ร่วมกันทั้ง PUT (บันทึกจริง) และ GET (โชว์) — ไม่มีพิกัดบ้านข้ามไปคงของเดิม
const refreshReturnLeg = async (planData, { startLat, startLng } = {}) => {
    if (!planData || typeof planData !== 'object' || !Array.isArray(planData.days)) return;
    const oldCost = Number(planData.returnLeg?.estimatedCost) || 0;
    const { returnLeg, tip, cost } = await computeReturnLeg(planData, { startLat, startLng });
    if (!returnLeg) return;
    planData.returnLeg = returnLeg;
    applyTransportDelta(planData, cost - oldCost);
    if (tip) {
        planData.tips = Array.isArray(planData.tips) ? planData.tips : [];
        if (!planData.tips.includes(tip)) planData.tips.push(tip);
    }
};

// ซ่อมแผนเก่าตอนเปิดดู (in-memory เท่านั้น — ไม่เขียนกลับ DB)
// แผนที่สร้างก่อนมีตัวกันโหมดเพี้ยน/รถเช่า เปิดดูก็เห็นขาบินในเมืองเหมือนเดิม
// จึงรัน pipeline เดียวกับ PUT ให้ตรงกัน: ลด flight ระยะสั้น → ปักธงรถเช่า → เดินโซ่เวลาใหม่
// (ไม่มีพิกัดจุดเริ่ม ขาแรกของวันวัดไม่ได้จึงข้ามเหมือน PUT)
const repairStoredPlanForDisplay = async (trip, places) => {
    const planData = trip?.plan_data;
    if (!planData || !Array.isArray(planData.days)) return;
    try {
        const { delta: downgradeDelta } = downgradeShortFlights(planData);
        const { delta: rentalDelta } = markRentalCarLegs(planData);
        applyTransportDelta(planData, downgradeDelta + rentalDelta);
    } catch {
        // best-effort — ล้มก็โชว์แผนเดิม
    }
    try {
        const warnings = chainAllDaysPreservingOrder(planData, {
            defaultStartMinutes: parseStartTimeInput(trip?.start_time),
            places: places || [],
        });
        if (warnings.length > 0) {
            planData.warnings = [...new Set([...(planData.warnings || []), ...warnings])];
            planData.tips = Array.isArray(planData.tips) ? planData.tips : [];
            for (const warning of warnings) {
                if (!planData.tips.includes(warning)) planData.tips.push(warning);
            }
        }
    } catch {
        // best-effort — ล้มก็โชว์เวลาที่เก็บไว้เดิม
    }
    // ขากลับคำนวณใหม่ด้วย (มากลับรถ=ขับกลับ / มาเครื่องบิน=ไปสนามบิน+บินกลับ)
    // ใช้พิกัดบ้านที่เก็บไว้ — ทริปเก่าไม่มีพิกัดข้ามไปคงขากลับเดิม
    try {
        await refreshReturnLeg(planData, {
            startLat: trip?.start_latitude,
            startLng: trip?.start_longitude,
        });
    } catch {
        // best-effort — ล้มก็โชว์ขากลับเดิม
    }
};

// POST /api/trips — สร้าง trip ใหม่แล้ว stream แผน
// สร้างแผนท่องเที่ยวด้วย AI และบันทึกเป็น trip ของผู้ใช้
const createTripHandler = ({ database = pool, planGenerator = generateTripPlan } = {}) => async (req, res) => {
    let tripId;
    try {
        const userId = req.user?.id || null;

        tripId = await tripRepository.createGeneratingTrip(
            {
                userId,
                title: req.body.title,
                destination: req.body.destination,
                province: req.body.province,
                // auto_days=true = ให้ AI ประเมินจำนวนวันที่เหมาะสม (resolve ใน aiHelper)
                // client เก่าส่ง days อย่างเดียว = ใช้ค่านั้นตรง ๆ (default 3)
                days: req.body.auto_days ? null : req.body.days,
                startTime: req.body.start_time,
                // start_date "YYYY-MM-DD" จาก DateRangePicker — เก็บลง trips เพื่อให้แผนเก่าโชว์วันที่จริงได้
                startDate: req.body.start_date,
                // พิกัดจุดเริ่มต้น — เก็บลง trips เพื่อคำนวณขากลับตอน PUT/GET
                startLatitude: req.body.start_latitude,
                startLongitude: req.body.start_longitude,
                budget: req.body.budget,
                currency: req.body.currency,
                travelStyle: req.body.travel_style,
                groupType: req.body.group_type,
                interests: req.body.interests,
            },
            database,
        );

        // stream แผนเที่ยวกลับไปเลย
        await planGenerator(tripId, req.body, res);

    } catch (err) {
        console.error('[tripController] createTrip:', err.message);
        if (tripId != null) {
            await tripRepository.markTripFailed(tripId, database).catch(() => {});
        }
        if (!res.headersSent) {
            res.status(500).json({ message: 'เกิดข้อผิดพลาดในการสร้างแผนเที่ยว' });
        }
    }
};

const createTrip = createTripHandler();

// GET /api/trips — ดึงประวัติแผนเที่ยวของ user
// คืนประวัติแผนท่องเที่ยวของผู้ใช้ที่ล็อกอินอยู่
const getUserTrips = async (req, res) => {
    try {
        const userId = req.user?.id;
        const rows = await tripRepository.findUserTripsWithPlans(userId);
        const places = await tripRepository.findApprovedPlanPlaces();
        for (const trip of rows) {
            normalizeStoredPlan(trip.plan_data, places);
            await repairStoredPlanForDisplay(trip, places);
        }
        res.json(rows);
    } catch (err) {
        console.error('[tripController] getUserTrips:', err.message);
        res.status(500).json({ message: 'เกิดข้อผิดพลาด' });
    }
};

// GET /api/trips/:id — ดึงแผนเที่ยวตาม ID
// คืนแผนท่องเที่ยวหนึ่งรายการเมื่อเป็นเจ้าของรายการนั้น
const getTripById = async (req, res) => {
    try {
        const trip = await tripRepository.findTripWithPlanById(req.params.id, req.user?.id);
        if (!trip) return res.status(404).json({ message: 'ไม่พบแผนเที่ยว' });
        const places = await tripRepository.findApprovedPlanPlaces();
        normalizeStoredPlan(trip.plan_data, places);
        await repairStoredPlanForDisplay(trip, places);
        res.json(trip);
    } catch (err) {
        console.error('[tripController] getTripById:', err.message);
        res.status(500).json({ message: 'เกิดข้อผิดพลาด' });
    }
};

// PUT /api/trips/:id/plan — บันทึกการแก้ไขแผนของผู้ใช้ (ลบ/เพิ่ม/สลับลำดับสถานที่)
// รับ plan_data ทั้งก้อนจาก mobile app แล้ว upsert ลง trip_plans
// เดินโซ่เวลาใหม่แบบคงลำดับที่ผู้ใช้จัด (chainAllDaysPreservingOrder) แล้วคืน warnings
// รับ start_time ("HH:MM") เสริมที่ top-level ได้ — ใช้เป็นเวลาเริ่มของวัน + บันทึกลง trips
const updateTripPlan = async (req, res) => {
    try {
        const tripId = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(tripId) || tripId <= 0) {
            return res.status(400).json({ message: 'trip id ไม่ถูกต้อง' });
        }

        const planData = req.body?.days ? req.body : null;
        if (!planData || !Array.isArray(planData.days)) {
            return res.status(400).json({ message: 'รูปแบบแผนการเดินทางไม่ถูกต้อง' });
        }
        sanitizePlaceholderPlanImages(planData);

        const owned = await tripRepository.isTripOwnedByUser(tripId, req.user?.id);
        if (!owned) {
            return res.status(404).json({ message: 'ไม่พบแผนเที่ยวหรือคุณไม่มีสิทธิ์แก้ไข' });
        }

        // ลำดับความสำคัญของเวลาเริ่มวัน: body.start_time > ค่าที่เก็บใน trips > arrivalTime จุดแรก
        // ลบ start_time ออกจาก planData ก่อน upsert กัน field ส่วนเกินค้างใน JSONB
        let defaultStartMinutes;
        if (typeof req.body?.start_time === 'string' && req.body.start_time.trim()) {
            defaultStartMinutes = parseStartTimeInput(req.body.start_time);
            await tripRepository.updateTripStartTime(tripId, req.body.start_time);
        } else {
            const stored = await tripRepository.findTripStartTimeById(tripId);
            defaultStartMinutes = stored != null
                ? parseStartTimeInput(stored)
                : undefined;
        }
        delete planData.start_time;
        // พิกัดบ้านจาก body (แอปส่งจุดเริ่มปัจจุบันมาด้วย) — เติมลง trips เฉพาะเมื่อยังไม่มี
        // แล้วใช้คำนวณขากลับ (body มาก่อนค่าที่เก็บไว้)
        const bodyLat = Number(req.body?.start_latitude);
        const bodyLng = Number(req.body?.start_longitude);
        const bodyCoordsValid = Number.isFinite(bodyLat) && Number.isFinite(bodyLng)
            && bodyLat >= -90 && bodyLat <= 90 && bodyLng >= -180 && bodyLng <= 180;
        if (bodyCoordsValid) {
            await tripRepository.updateTripStartCoordsIfMissing(tripId, bodyLat, bodyLng).catch(() => {});
        }
        let storedCoords = { latitude: null, longitude: null };
        try {
            storedCoords = await tripRepository.findTripStartCoordsById(tripId);
        } catch {
            storedCoords = { latitude: null, longitude: null };
        }
        const homeLat = bodyCoordsValid ? bodyLat : storedCoords.latitude;
        const homeLng = bodyCoordsValid ? bodyLng : storedCoords.longitude;
        // โหลดสถานที่พร้อมเวลาเปิด-ปิดเพื่อตรวจเที่ยดึก/นอกเวลาเปิด (best-effort — ล้มก็ตรวจแค่เที่ยวดึก)
        let planPlaces = [];
        try {
            planPlaces = await tripRepository.findApprovedPlanPlaces();
        } catch {
            planPlaces = [];
        }
        // กันโหมดเพี้ยนค้างจากแผนเก่า (เช่น ขาในเมือง 3 กม. เป็น flight) — ลดเป็นรถยนต์ก่อนเดินโซ่
        // ไม่มีพิกัดจุดเริ่ม ขาแรกของวันวัดไม่ได้จึงข้าม (แก้เฉพาะขาที่วัดระยะได้)
        // ขารถหลังขาบินคือรถเช่า (บินไปแล้วไม่มีรถส่วนตัว) — ปักธงก่อนเดินโซ่เช่นกัน
        try {
            const { delta: downgradeDelta } = downgradeShortFlights(planData);
            const { delta: rentalDelta } = markRentalCarLegs(planData);
            applyTransportDelta(planData, downgradeDelta + rentalDelta);
        } catch {
            // best-effort — ล้มก็เดินโซ่เวลาต่อด้วยโหมด/ราคาเดิม
        }
        const warnings = chainAllDaysPreservingOrder(
            planData,
            defaultStartMinutes === undefined
                ? { places: planPlaces }
                : { defaultStartMinutes, places: planPlaces },
        );
        if (warnings.length > 0) {
            planData.warnings = [...new Set([...(planData.warnings || []), ...warnings])];
            planData.tips = Array.isArray(planData.tips) ? planData.tips : [];
            for (const warning of warnings) {
                if (!planData.tips.includes(warning)) planData.tips.push(warning);
            }
        }

        // ขากลับคำนวณใหม่ทุกครั้งที่บันทึก (มากลับรถ=ขับกลับ / มาเครื่องบิน=ไปสนามบิน+บินกลับ)
        // ใช้พิกัดบ้านที่ resolve แล้ว — ไม่มีพิกัดคงขากลับเดิมไว้
        try {
            await refreshReturnLeg(planData, { startLat: homeLat, startLng: homeLng });
        } catch {
            // best-effort — ล้มก็ใช้ขากลับเดิม
        }

        await tripRepository.upsertTripPlan(tripId, JSON.stringify(planData));
        // user เพิ่ม/ลบวันเองจากแอปได้ — sync จำนวนวันกลับ trips.days ให้การ์ด Profile ตรง
        // (normalizeDays clamp 1..7; วันเปล่า chainAllDaysPreservingOrder ข้ามให้อยู่แล้ว)
        await tripRepository.updateTripDays(tripId, planData.days.length);

        // ส่งขากลับ + ยอดรวมล่าสุดกลับไปด้วย — แอปอัปเดตหน้าจอทันทีโดยไม่ต้องโหลดใหม่
        res.json({
            message: 'บันทึกแผนการเดินทางสำเร็จ',
            warnings,
            returnLeg: planData.returnLeg ?? null,
            totalEstimatedCost: planData.totalEstimatedCost ?? 0,
            budgetBreakdown: planData.budgetBreakdown ?? {},
        });
    } catch (err) {
        console.error('[tripController] updateTripPlan:', err.message);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการบันทึกแผนการเดินทาง' });
    }
};

// PATCH /api/trips/:id — เปลี่ยนชื่อแผนเที่ยว
// รับ { title } แล้วอัปเดตเฉพาะคอลัมน์ title ของ trip ที่เป็นเจ้าของ
const renameTrip = async (req, res) => {
    try {
        const tripId = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(tripId) || tripId <= 0) {
            return res.status(400).json({ message: 'trip id ไม่ถูกต้อง' });
        }
        const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
        if (!title) {
            return res.status(400).json({ message: 'กรุณาตั้งชื่อแผน' });
        }
        if (title.length > 120) {
            return res.status(400).json({ message: 'ชื่อแผนยาวเกินไป (สูงสุด 120 ตัวอักษร)' });
        }
        const rowCount = await tripRepository.renameTripById(tripId, req.user?.id, title);
        if (rowCount === 0) {
            return res.status(404).json({ message: 'ไม่พบแผนเที่ยวหรือคุณไม่มีสิทธิ์แก้ไข' });
        }
        res.json({ message: 'เปลี่ยนชื่อแผนสำเร็จ', title });
    } catch (err) {
        console.error('[tripController] renameTrip:', err.message);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการเปลี่ยนชื่อแผน' });
    }
};

// DELETE /api/trips/:id — ลบแผนเที่ยวตาม ID
// ลบแผนเที่ยวเมื่อเป็นเจ้าของรายการนั้น
const deleteTrip = async (req, res) => {
    try {
        const rowCount = await tripRepository.deleteTripById(req.params.id, req.user?.id);
        if (rowCount === 0) {
            return res.status(404).json({ message: 'ไม่พบแผนเที่ยวหรือคุณไม่มีสิทธิ์ลบ' });
        }
        res.json({ message: 'ลบแผนเที่ยวสำเร็จ' });
    } catch (err) {
        console.error('[tripController] deleteTrip:', err.message);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการลบแผนเที่ยว' });
    }
};

module.exports = { createTrip, getUserTrips, getTripById, deleteTrip, updateTripPlan, renameTrip };
