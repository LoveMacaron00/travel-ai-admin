const pool = require('./db');

/**
 * สร้างตารางเก็บช่วงเวลาที่ผู้ใช้เปิดแอปและ view สถานที่แบบ idempotent
 *
 * เรียกตอน server เริ่มทำงานเพื่อรองรับฐานข้อมูลเดิมที่สร้างก่อนมีระบบ
 * analytics โดยไม่ต้องลบข้อมูลหรือรัน init.sql ใหม่ทั้งไฟล์
 */
const ensureAppUsageSchema = async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS app_usage_sessions (
            id BIGSERIAL PRIMARY KEY,
            user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ended_at TIMESTAMPTZ
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_app_usage_sessions_user
        ON app_usage_sessions(user_id)
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_app_usage_sessions_started
        ON app_usage_sessions(started_at)
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_app_usage_sessions_last_seen
        ON app_usage_sessions(last_seen_at)
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS destination_view_events (
            id BIGSERIAL PRIMARY KEY,
            destination_id INT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
            user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            usage_session_id BIGINT NOT NULL REFERENCES app_usage_sessions(id) ON DELETE CASCADE,
            viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT destination_view_once_per_session
                UNIQUE (usage_session_id, destination_id)
        )
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_destination_views_destination_time
        ON destination_view_events(destination_id, viewed_at DESC)
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_destination_views_user_time
        ON destination_view_events(user_id, viewed_at DESC)
    `);
};

module.exports = { ensureAppUsageSchema };
