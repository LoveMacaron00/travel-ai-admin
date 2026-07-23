const pool = require('../config/db');
const { config } = require('../config/env');
const {
    calculateGrowth,
    formatPeakUsageTime,
    getAnalyticsRange,
} = require('./helpers/analyticsHelper');
const { parsePositiveInteger } = require('./helpers/numberHelper');

const destinationColors = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6'];

// เติมเปอร์เซ็นต์เทียบอันดับสูงสุดและสีสำหรับแสดงอันดับสถานที่
const withRankStats = (destinations) => {
    const maxViewer = Math.max(...destinations.map((destination) => destination.viewer), 1);

    return destinations.map((destination, index) => ({
        ...destination,
        percent: Math.max(1, Math.round((destination.viewer / maxViewer) * 100)),
        color: destinationColors[index % destinationColors.length],
    }));
};

// คำนวณตัวเลขสรุปการใช้งานและการเปิดดูสถานที่ตามช่วงเวลา
const getSummary = async (range, timeZone) => {
    const { rows } = await pool.query(
        `WITH month_bounds AS (
            SELECT
                date_trunc('month', timezone($1, NOW())) AS current_month,
                date_trunc('month', timezone($1, NOW())) - INTERVAL '1 month' AS previous_month
        )
        SELECT
            (SELECT COUNT(*)::int FROM users) AS total_registered_users,
            (
                SELECT COUNT(DISTINCT user_id)::int
                FROM app_usage_sessions
                WHERE ended_at IS NULL
                  AND last_seen_at >= NOW() - INTERVAL '2 minutes'
            ) AS active_users_now,
            (
                SELECT COUNT(DISTINCT sessions.user_id)::int
                FROM app_usage_sessions sessions, month_bounds bounds
                WHERE timezone($1, sessions.last_seen_at) >= bounds.current_month
            ) AS monthly_active_users,
            (
                SELECT COUNT(DISTINCT sessions.user_id)::int
                FROM app_usage_sessions sessions, month_bounds bounds
                WHERE timezone($1, sessions.last_seen_at) >= bounds.previous_month
                  AND timezone($1, sessions.last_seen_at) < bounds.current_month
            ) AS previous_monthly_active_users,
            (
                SELECT COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (last_seen_at - started_at))))::int, 0)
                FROM app_usage_sessions
                WHERE started_at >= NOW() - $2::interval
            ) AS average_session_seconds,
            (
                SELECT COUNT(*)::int
                FROM app_usage_sessions
                WHERE started_at >= NOW() - $2::interval
            ) AS total_sessions,
            (
                SELECT COUNT(*)::int
                FROM destination_view_events views, month_bounds bounds
                WHERE timezone($1, views.viewed_at) >= bounds.current_month
            ) AS monthly_destination_views,
            (
                SELECT COUNT(DISTINCT views.user_id)::int
                FROM destination_view_events views, month_bounds bounds
                WHERE timezone($1, views.viewed_at) >= bounds.current_month
            ) AS monthly_unique_destination_viewers,
            (
                SELECT COUNT(*)::int
                FROM destination_view_events
                WHERE viewed_at >= NOW() - $2::interval
            ) AS period_destination_views,
            (
                SELECT COUNT(DISTINCT user_id)::int
                FROM destination_view_events
                WHERE viewed_at >= NOW() - $2::interval
            ) AS period_unique_destination_viewers`,
        [timeZone, range.lookback],
    );

    const summary = rows[0];
    return {
        totalRegisteredUsers: summary.total_registered_users,
        activeUsersNow: summary.active_users_now,
        monthlyActiveUsers: summary.monthly_active_users,
        monthlyUserGrowth: calculateGrowth(
            summary.monthly_active_users,
            summary.previous_monthly_active_users,
        ),
        averageSessionSeconds: summary.average_session_seconds,
        totalSessions: summary.total_sessions,
        monthlyDestinationViews: summary.monthly_destination_views,
        monthlyUniqueDestinationViewers: summary.monthly_unique_destination_viewers,
        periodDestinationViews: summary.period_destination_views,
        periodUniqueDestinationViewers: summary.period_unique_destination_viewers,
    };
};

// หาเวลาหนึ่งชั่วโมงที่เริ่ม session มากที่สุดในช่วงที่เลือก
const getPeakUsageTime = async (range, timeZone) => {
    const { rows } = await pool.query(
        `SELECT
            EXTRACT(HOUR FROM timezone($1, started_at))::int AS hour,
            COUNT(*)::int AS session_count
         FROM app_usage_sessions
         WHERE started_at >= NOW() - $2::interval
         GROUP BY hour
         ORDER BY session_count DESC, hour ASC
         LIMIT 1`,
        [timeZone, range.lookback],
    );
    return formatPeakUsageTime(rows[0]?.hour);
};

// สร้างข้อมูลกราฟการใช้งานและยอดดูราย time bucket
const getTrendData = async (range, timeZone) => {
    // SQL fragment ทุกค่ามาจาก analyticsRanges ที่กำหนดใน source เท่านั้น
    // ไม่รับ unit/interval ตรงจาก query string เพื่อป้องกัน SQL injection
    const { rows } = await pool.query(
        `WITH settings AS (
            SELECT timezone($1, NOW()) AS now_local
        ), buckets AS (
            SELECT generate_series(
                date_trunc('${range.bucketUnit}', now_local) - INTERVAL '${range.bucketOffset}',
                date_trunc('${range.bucketUnit}', now_local),
                INTERVAL '${range.bucketStep}'
            ) AS bucket
            FROM settings
        )
        SELECT
            to_char(buckets.bucket, 'YYYY-MM-DD"T"HH24:MI:SS') AS key,
            to_char(buckets.bucket, '${range.labelFormat}') AS label,
            COUNT(DISTINCT sessions.user_id)::int AS active_users,
            COUNT(DISTINCT sessions.id)::int AS sessions,
            (
                SELECT COUNT(*)::int
                FROM destination_view_events views
                WHERE timezone($1, views.viewed_at) >= buckets.bucket
                  AND timezone($1, views.viewed_at) < buckets.bucket + INTERVAL '${range.bucketStep}'
            ) AS destination_views,
            (
                SELECT COUNT(DISTINCT views.user_id)::int
                FROM destination_view_events views
                WHERE timezone($1, views.viewed_at) >= buckets.bucket
                  AND timezone($1, views.viewed_at) < buckets.bucket + INTERVAL '${range.bucketStep}'
            ) AS unique_destination_viewers
        FROM buckets
        LEFT JOIN app_usage_sessions sessions
          ON timezone($1, sessions.started_at) < buckets.bucket + INTERVAL '${range.bucketStep}'
         AND timezone($1, sessions.last_seen_at) >= buckets.bucket
        GROUP BY buckets.bucket
        ORDER BY buckets.bucket ASC`,
        [timeZone],
    );

    return rows.map((row) => ({
        key: row.key,
        label: row.label,
        activeUsers: row.active_users,
        sessions: row.sessions,
        destinationViews: row.destination_views,
        uniqueDestinationViewers: row.unique_destination_viewers,
    }));
};

// จัดอันดับห้าสถานที่ approved ที่ถูกเปิดดูมากที่สุดในช่วงที่เลือก
const getTopDestinations = async (range) => {
    const { rows } = await pool.query(
        `SELECT
            destinations.id,
            destinations.name,
            destinations.province,
            destinations.category,
            destinations.image_url,
            COUNT(views.id)::int AS view_count,
            COUNT(DISTINCT views.user_id)::int AS unique_viewers
         FROM destinations
         LEFT JOIN destination_view_events views
           ON views.destination_id = destinations.id
          AND views.viewed_at >= NOW() - $1::interval
         WHERE destinations.status = 'approved'
         GROUP BY destinations.id
         ORDER BY view_count DESC, unique_viewers DESC,
                  destinations.created_at DESC
         LIMIT 5`,
        [range.lookback],
    );

    const destinations = rows.map((destination) => ({
        id: destination.id,
        name: destination.name,
        location: destination.province || 'Thailand',
        image: destination.image_url,
        viewer: destination.view_count,
        uniqueViewers: destination.unique_viewers,
        category: destination.category,
    }));
    return withRankStats(destinations);
};

// สร้างข้อมูลกราฟยอดดูสำหรับสถานที่หนึ่งแห่ง
const getDestinationTrendData = async (range, timeZone, destinationId) => {
    const { rows } = await pool.query(
        `WITH settings AS (
            SELECT timezone($1, NOW()) AS now_local
        ), buckets AS (
            SELECT generate_series(
                date_trunc('${range.bucketUnit}', now_local) - INTERVAL '${range.bucketOffset}',
                date_trunc('${range.bucketUnit}', now_local),
                INTERVAL '${range.bucketStep}'
            ) AS bucket
            FROM settings
        )
        SELECT
            to_char(buckets.bucket, 'YYYY-MM-DD"T"HH24:MI:SS') AS key,
            to_char(buckets.bucket, '${range.labelFormat}') AS label,
            COUNT(views.id)::int AS views,
            COUNT(DISTINCT views.user_id)::int AS unique_viewers
        FROM buckets
        LEFT JOIN destination_view_events views
          ON views.destination_id = $2
         AND timezone($1, views.viewed_at) >= buckets.bucket
         AND timezone($1, views.viewed_at) < buckets.bucket + INTERVAL '${range.bucketStep}'
        GROUP BY buckets.bucket
        ORDER BY buckets.bucket ASC`,
        [timeZone, destinationId],
    );

    return rows.map((row) => ({
        key: row.key,
        label: row.label,
        views: row.views,
        uniqueViewers: row.unique_viewers,
    }));
};

/** GET /api/analytics/destinations/:id/trend?range=24h|7d|30d|90d */
// ส่งแนวโน้มยอดดูของสถานที่ตาม id ให้ dashboard admin
const getDestinationTrend = async (req, res) => {
    try {
        const destinationId = parsePositiveInteger(req.params.id);
        if (destinationId == null) {
            return res.status(400).json({ message: 'รหัสสถานที่ไม่ถูกต้อง' });
        }

        const { rows } = await pool.query(
            `SELECT id, name
             FROM destinations
             WHERE id = $1 AND status = 'approved'`,
            [destinationId],
        );
        const destination = rows[0];
        if (!destination) return res.status(404).json({ message: 'ไม่พบสถานที่' });

        const range = getAnalyticsRange(req.query.range);
        const timeZone = config.analytics.timeZone;
        const trendData = await getDestinationTrendData(range, timeZone, destinationId);
        return res.json({
            destination,
            period: range.key,
            periodLabel: range.label,
            timeZone,
            trendData,
        });
    } catch (error) {
        console.error('[analyticsController] destination trend error:', error);
        return res.status(500).json({ message: 'ไม่สามารถโหลดแนวโน้มสถานที่ได้' });
    }
};

/** GET /api/analytics/overview?range=24h|7d|30d|90d */
// ส่งข้อมูลภาพรวมทั้งหมดที่หน้า dashboard analytics ต้องใช้
const getOverview = async (req, res) => {
    try {
        const range = getAnalyticsRange(req.query.range);
        const timeZone = config.analytics.timeZone;
        const [summary, peakUsageTime, trendData, topDestinations] = await Promise.all([
            getSummary(range, timeZone),
            getPeakUsageTime(range, timeZone),
            getTrendData(range, timeZone),
            getTopDestinations(range),
        ]);

        res.json({
            period: range.key,
            periodLabel: range.label,
            timeZone,
            generatedAt: new Date().toISOString(),
            summary: { ...summary, peakUsageTime },
            trendData,
            topDestinations,
        });
    } catch (error) {
        console.error('[analyticsController] overview error:', error);
        res.status(500).json({ message: 'ไม่สามารถโหลดข้อมูลสถิติได้' });
    }
};

module.exports = {
    getOverview,
    getDestinationTrend,
    getDestinationTrendData,
    getPeakUsageTime,
    getSummary,
    getTopDestinations,
    getTrendData,
};
