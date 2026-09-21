// server/repositories/tripRepository.js
// ชั้นเข้าถึงฐานข้อมูลของ trips — ย้าย SQL ออกจาก tripController
// รับ db เสริมได้ (pool หรือ transaction client) เพื่อให้ reuse และทดสอบได้
const pool = require('../config/db');

// สถานที่ approved สำหรับ normalize แผนที่เก็บไว้
// รวมเวลาเปิด-ปิดด้วยเพื่อตรวจตารางเที่ยวดึก/นอกเวลาเปิด (planScheduler.validateOpeningAndLateNight)
const findApprovedPlanPlaces = async (db = pool) => {
    const { rows } = await db.query(
        `SELECT id, name, image_url, latitude, longitude,
                opening_time, closing_time, opening_hours, tat_raw
         FROM destinations
         WHERE status = 'approved'`,
    );
    return rows;
};

// เติมคอลัมน์ title ให้ DB เก่าที่สร้างจาก init.sql ก่อนจะมีคอลัมน์นี้
// รันครั้งเดียวต่อ process (flag ใน memory) — ถ้า DB ใหม่มีคอลัมน์อยู่แล้วจะเป็น no-op
let _tripsTitleEnsured = false;
const ensureTripsTitleColumn = async (db = pool) => {
    if (_tripsTitleEnsured) return;
    await db.query(`ALTER TABLE trips ADD COLUMN IF NOT EXISTS title VARCHAR(255)`);
    _tripsTitleEnsured = true;
};

// เติมคอลัมน์ start_time ("HH:MM", NULL = 09:00) ให้ DB เก่า — pattern เดียวกับ title
let _tripsStartTimeEnsured = false;
const ensureTripsStartTimeColumn = async (db = pool) => {
    if (_tripsStartTimeEnsured) return;
    await db.query(`ALTER TABLE trips ADD COLUMN IF NOT EXISTS start_time VARCHAR(5)`);
    _tripsStartTimeEnsured = true;
};

// เติมคอลัมน์ start_date ("YYYY-MM-DD", NULL = ไม่ระบุ) ให้ DB เก่า — pattern เดียวกับ title
// ใช้แสดงหัวข้อแต่ละวันเป็นวันที่จริง (start + day - 1) แม้เปิดแผนเก่าจาก Profile
let _tripsStartDateEnsured = false;
const ensureTripsStartDateColumn = async (db = pool) => {
    if (_tripsStartDateEnsured) return;
    await db.query(`ALTER TABLE trips ADD COLUMN IF NOT EXISTS start_date DATE`);
    _tripsStartDateEnsured = true;
};

// เติมคอลัมน์พิกัดจุดเริ่มต้น (NULL = ทริปเก่าที่สร้างก่อนมีฟิลด์นี้) — pattern เดียวกับ title
// ใช้คำนวณขากลับ (returnLeg) ตอน PUT/GET แม้ client ไม่ส่งพิกัดมาใหม่
let _tripsStartCoordsEnsured = false;
const ensureTripsStartCoordsColumns = async (db = pool) => {
    if (_tripsStartCoordsEnsured) return;
    await db.query(`ALTER TABLE trips ADD COLUMN IF NOT EXISTS start_latitude DOUBLE PRECISION`);
    await db.query(`ALTER TABLE trips ADD COLUMN IF NOT EXISTS start_longitude DOUBLE PRECISION`);
    _tripsStartCoordsEnsured = true;
};

const ensureTripsPlanColumns = async (db = pool) => {
    await ensureTripsTitleColumn(db);
    await ensureTripsStartTimeColumn(db);
    await ensureTripsStartDateColumn(db);
    await ensureTripsStartCoordsColumns(db);
};

// พิกัดที่ใช้ได้เท่านั้น (lat -90..90, lng -180..180) — อย่างอื่นถือว่าไม่ได้ส่งมา (เก็บ NULL)
const normalizeStartCoord = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
    return parsed;
};

// "HH:MM" ที่ใช้ได้เท่านั้น — อย่างอื่นถือว่าไม่ได้ส่งมา (backend ใช้ 09:00 แทน)
const normalizeStartTime = (value) => {
    const text = typeof value === 'string' ? value.trim() : '';
    const match = text.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

// "YYYY-MM-DD" ที่ใช้ได้เท่านั้น — อย่างอื่นถือว่าไม่ได้ส่งมา (เก็บ NULL แทน)
// รับทั้งแบบ zero-padded (2026-09-05) และเลขหลักเดียว (2026-9-5) แล้ว pad ให้ก่อนเก็บ
// รวมทั้ง ISO เต็มจาก client เก่า (2026-09-13T00:00:00.000) — ตัดเอาแค่วันที่
const normalizeStartDate = (value) => {
    const text = typeof value === 'string' ? value.trim() : '';
    const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
    if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

// days เก็บ 1..7 เสมอ — client เก่าที่ไม่ส่งมาถือว่า 3 วัน (คงพฤติกรรมเดิม)
const normalizeDays = (value, fallback = 3) => {
    const parsed = Number.parseInt(String(value ?? fallback), 10);
    if (!Number.isInteger(parsed)) return fallback;
    return Math.min(7, Math.max(1, parsed));
};

// สร้าง trip ใหม่สถานะ generating คืน id
const createGeneratingTrip = async ({
    userId,
    title,
    destination,
    province,
    days,
    startTime,
    startDate,
    startLatitude,
    startLongitude,
    budget,
    currency,
    travelStyle,
    groupType,
    interests,
}, db = pool) => {
    await ensureTripsPlanColumns(db);
    const { rows } = await db.query(
        `INSERT INTO trips
            (user_id, title, destination, province, days, start_time, start_date,
             start_latitude, start_longitude, budget, currency,
             travel_style, group_type, interests, status)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'generating')
          RETURNING id`,
        [
            userId,
            (typeof title === 'string' && title.trim() ? title.trim().slice(0, 120) : null),
            destination || 'Near current location',
            province || null,
            normalizeDays(days),
            normalizeStartTime(startTime),
            normalizeStartDate(startDate),
            normalizeStartCoord(startLatitude, -90, 90),
            normalizeStartCoord(startLongitude, -180, 180),
            budget || null,
            currency || 'THB',
            travelStyle || null,
            groupType || null,
            JSON.stringify(interests || []),
        ],
    );
    return rows[0].id;
};

// หมายเหตุ trip ว่าสร้างแผนล้มเหลว
const markTripFailed = async (tripId, db = pool) => {
    await db.query(`UPDATE trips SET status = 'failed' WHERE id = $1`, [tripId]);
};

// หมายเหตุ trip ว่าสร้างแผนเสร็จสิ้น
const markTripDone = async (tripId, db = pool) => {
    await db.query(`UPDATE trips SET status = 'done' WHERE id = $1`, [tripId]);
};

// บันทึกแผนที่ AI สร้างลง trip_plans
const saveGeneratedPlan = async (tripId, planData, fullText, db = pool) => {
    await db.query(
        `INSERT INTO trip_plans (trip_id, plan_data, markdown_cache)
         VALUES ($1, $2, $3)`,
        [tripId, JSON.stringify(planData), fullText],
    );
};

// ประวัติแผนเที่ยวของ user พร้อม plan_data ล่าสุด 20 รายการ
const findUserTripsWithPlans = async (userId, db = pool) => {
    await ensureTripsPlanColumns(db);
    const { rows } = await db.query(
        `SELECT t.id, t.title, t.destination, t.province, t.days, t.start_time, t.start_date,
                t.start_latitude, t.start_longitude, t.budget,
                t.travel_style, t.group_type, t.status, t.created_at,
                tp.plan_data
         FROM trips t
         LEFT JOIN trip_plans tp ON tp.trip_id = t.id
         WHERE t.user_id = $1
         ORDER BY t.created_at DESC
         LIMIT 20`,
        [userId],
    );
    return rows;
};

// แผนเที่ยวหนึ่งรายการเมื่อเป็นเจ้าของ คืน trip หรือ null
const findTripWithPlanById = async (tripId, userId, db = pool) => {
    await ensureTripsPlanColumns(db);
    const { rows } = await db.query(
        `SELECT t.*, tp.plan_data, tp.markdown_cache, tp.generated_at
         FROM trips t
         LEFT JOIN trip_plans tp ON tp.trip_id = t.id
         WHERE t.id = $1 AND t.user_id = $2`,
        [tripId, userId],
    );
    return rows[0] || null;
};

// อ่าน start_time ที่เก็บไว้ของ trip (NULL = ใช้ 09:00)
const findTripStartTimeById = async (tripId, db = pool) => {
    await ensureTripsPlanColumns(db);
    const { rows } = await db.query(
        `SELECT start_time FROM trips WHERE id = $1`,
        [tripId],
    );
    return rows[0]?.start_time ?? null;
};

// อ่านพิกัดจุดเริ่มต้นที่เก็บไว้ (NULL = ทริปเก่า) — ใช้คำนวณขากลับตอน PUT/GET
const findTripStartCoordsById = async (tripId, db = pool) => {
    await ensureTripsPlanColumns(db);
    const { rows } = await db.query(
        `SELECT start_latitude, start_longitude FROM trips WHERE id = $1`,
        [tripId],
    );
    const lat = Number(rows[0]?.start_latitude);
    const lng = Number(rows[0]?.start_longitude);
    return {
        latitude: Number.isFinite(lat) ? lat : null,
        longitude: Number.isFinite(lng) ? lng : null,
    };
};

// เติมพิกัดจุดเริ่มต้นเฉพาะเมื่อยังไม่มี (backfill ทริปเก่าครั้งเดียว — ไม่เขียนทับของเดิม)
const updateTripStartCoordsIfMissing = async (tripId, latitude, longitude, db = pool) => {
    const lat = normalizeStartCoord(latitude, -90, 90);
    const lng = normalizeStartCoord(longitude, -180, 180);
    if (lat == null || lng == null) return 0;
    await ensureTripsPlanColumns(db);
    const { rowCount } = await db.query(
        `UPDATE trips SET start_latitude = $2, start_longitude = $3
          WHERE id = $1 AND (start_latitude IS NULL OR start_longitude IS NULL)`,
        [tripId, lat, lng],
    );
    return rowCount;
};

// อัปเดตจำนวนวันที่ resolve แล้ว (เช่น auto_days คำนวณได้ 4 วันแต่ตอน insert เก็บ 3 ไว้ชั่วคราว)
const updateTripDays = async (tripId, days, db = pool) => {
    await db.query(`UPDATE trips SET days = $2 WHERE id = $1`, [tripId, normalizeDays(days)]);
};

// อัปเดตเวลาเริ่มเดินทาง ("HH:MM" ใช้ไม่ได้ = ไม่แตะค่าที่เก็บไว้)
const updateTripStartTime = async (tripId, startTime, db = pool) => {
    const normalized = normalizeStartTime(startTime);
    if (!normalized) return 0;
    await ensureTripsPlanColumns(db);
    const { rowCount } = await db.query(
        `UPDATE trips SET start_time = $2 WHERE id = $1`,
        [tripId, normalized],
    );
    return rowCount;
};

// ตรวจว่า trip เป็นของผู้ใช้หรือไม่
const isTripOwnedByUser = async (tripId, userId, db = pool) => {
    const owned = await db.query(
        `SELECT 1 FROM trips WHERE id = $1 AND user_id = $2`,
        [tripId, userId],
    );
    return owned.rowCount !== 0;
};

// บันทึก plan_data ทั้งก้อน (อัปเดตก่อน insert เมื่อยังไม่มีแถว)
const upsertTripPlan = async (tripId, planJson, db = pool) => {
    // trip_plans ไม่มี unique constraint บน trip_id จึงอัปเดตก่อนแล้วค่อย insert เมื่อยังไม่มีแถว
    const updated = await db.query(
        `UPDATE trip_plans
         SET plan_data = $2, markdown_cache = NULL, version = version + 1, generated_at = NOW()
         WHERE trip_id = $1`,
        [tripId, planJson],
    );
    if (updated.rowCount === 0) {
        await db.query(
            `INSERT INTO trip_plans (trip_id, plan_data, markdown_cache)
             VALUES ($1, $2, NULL)`,
            [tripId, planJson],
        );
    }
};

// เปลี่ยนชื่อแผนของผู้ใช้ คืนจำนวนแถวที่อัปเดต (0 = ไม่มีสิทธิ์/ไม่มี trip)
const renameTripById = async (tripId, userId, title, db = pool) => {
    await ensureTripsTitleColumn(db);
    const { rowCount } = await db.query(
        `UPDATE trips SET title = $3 WHERE id = $1 AND user_id = $2`,
        [tripId, userId, title],
    );
    return rowCount;
};

// ลบ trip ของผู้ใช้ คืนจำนวนแถวที่ลบ
const deleteTripById = async (tripId, userId, db = pool) => {
    const { rowCount } = await db.query(
        `DELETE FROM trips WHERE id = $1 AND user_id = $2`,
        [tripId, userId],
    );
    return rowCount;
};

module.exports = {
    ensureTripsPlanColumns,
    normalizeStartTime,
    normalizeStartDate,
    normalizeDays,
    findApprovedPlanPlaces,
    createGeneratingTrip,
    markTripFailed,
    markTripDone,
    saveGeneratedPlan,
    findUserTripsWithPlans,
    findTripWithPlanById,
    findTripStartTimeById,
    findTripStartCoordsById,
    updateTripStartCoordsIfMissing,
    updateTripDays,
    updateTripStartTime,
    isTripOwnedByUser,
    upsertTripPlan,
    renameTripById,
    deleteTripById,
};
