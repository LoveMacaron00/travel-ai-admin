// server/repositories/tripRepository.js
// ชั้นเข้าถึงฐานข้อมูลของ trips — ย้าย SQL ออกจาก tripController
// รับ db เสริมได้ (pool หรือ transaction client) เพื่อให้ reuse และทดสอบได้
const pool = require('../config/db');

// สถานที่ approved สำหรับ normalize แผนที่เก็บไว้
const findApprovedPlanPlaces = async (db = pool) => {
    const { rows } = await db.query(
        `SELECT id, name, image_url, latitude, longitude
         FROM destinations
         WHERE status = 'approved'`,
    );
    return rows;
};

// สร้าง trip ใหม่สถานะ generating คืน id
const createGeneratingTrip = async ({
    userId,
    destination,
    province,
    days,
    budget,
    currency,
    travelStyle,
    groupType,
    interests,
}, db = pool) => {
    const { rows } = await db.query(
        `INSERT INTO trips
            (user_id, destination, province, days, budget, currency,
             travel_style, group_type, interests, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'generating')
         RETURNING id`,
        [
            userId,
            destination || 'Near current location',
            province || null,
            days || 3,
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
    const { rows } = await db.query(
        `SELECT t.id, t.destination, t.province, t.days, t.budget,
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
    const { rows } = await db.query(
        `SELECT t.*, tp.plan_data, tp.markdown_cache, tp.generated_at
         FROM trips t
         LEFT JOIN trip_plans tp ON tp.trip_id = t.id
         WHERE t.id = $1 AND t.user_id = $2`,
        [tripId, userId],
    );
    return rows[0] || null;
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

// ลบ trip ของผู้ใช้ คืนจำนวนแถวที่ลบ
const deleteTripById = async (tripId, userId, db = pool) => {
    const { rowCount } = await db.query(
        `DELETE FROM trips WHERE id = $1 AND user_id = $2`,
        [tripId, userId],
    );
    return rowCount;
};

module.exports = {
    findApprovedPlanPlaces,
    createGeneratingTrip,
    markTripFailed,
    markTripDone,
    saveGeneratedPlan,
    findUserTripsWithPlans,
    findTripWithPlanById,
    isTripOwnedByUser,
    upsertTripPlan,
    deleteTripById,
};
