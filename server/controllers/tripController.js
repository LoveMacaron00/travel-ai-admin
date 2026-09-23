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
    stripLegacyLodgingAndRestStops,
} = require('../utils/planScheduler');
const tripRepository = require('../repositories/tripRepository');

const normalizeStoredPlan = (planData, places) => {
    // แผนเก่าอาจมีจุดแวะพัก/ปั๊ม/ที่พักตกค้าง — ตัดออกก่อน (in-memory ไม่เขียนกลับ DB)
    // พร้อมปรับงบตามยอดที่ตัด แผนใหม่ไม่มี stop พวกนี้แล้ว
    stripLegacyLodgingAndRestStops(planData);
    normalizePlanPlaces(planData, places);
    sanitizePlaceholderPlanImages(planData);
};

// ซ่อมแผนเก่าตอนเปิดดู (in-memory เท่านั้น — ไม่เขียนกลับ DB)
// เดินโซ่เวลาใหม่ให้ตรงกับเวลาที่เก็บไว้ + เติม warnings (วันแน่น/เที่ยวดึก/นอกเวลาเปิด)
const repairStoredPlanForDisplay = async (trip, places) => {
    const planData = trip?.plan_data;
    if (!planData || !Array.isArray(planData.days)) return;
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
        delete planData.start_latitude;
        delete planData.start_longitude;
        // โหลดสถานที่พร้อมเวลาเปิด-ปิดเพื่อตรวจเที่ยดึก/นอกเวลาเปิด (best-effort — ล้มก็ตรวจแค่เที่ยวดึก)
        let planPlaces = [];
        try {
            planPlaces = await tripRepository.findApprovedPlanPlaces();
        } catch {
            planPlaces = [];
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

        await tripRepository.upsertTripPlan(tripId, JSON.stringify(planData));
        // user เพิ่ม/ลบวันเองจากแอปได้ — sync จำนวนวันกลับ trips.days ให้การ์ด Profile ตรง
        // (normalizeDays clamp 1..7; วันเปล่า chainAllDaysPreservingOrder ข้ามให้อยู่แล้ว)
        await tripRepository.updateTripDays(tripId, planData.days.length);

        res.json({
            message: 'บันทึกแผนการเดินทางสำเร็จ',
            warnings,
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
