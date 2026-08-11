WITH target_user AS (
    SELECT id
    FROM users
    WHERE LOWER(email) = 'web@gmail.com'
), ranked_destinations AS (
    SELECT
        destination.id,
        ROW_NUMBER() OVER (
            PARTITION BY destination.province
            ORDER BY
                CASE WHEN NULLIF(BTRIM(destination.description), '') IS NULL THEN 1 ELSE 0 END,
                destination.id
        ) AS province_rank
    FROM destinations destination
    WHERE destination.status = 'approved'
      AND destination.latitude IS NOT NULL
      AND destination.longitude IS NOT NULL
      AND NULLIF(BTRIM(destination.province), '') IS NOT NULL
      AND NULLIF(BTRIM(destination.image_url), '') IS NOT NULL
), selected_destinations AS (
    SELECT
        id,
        ROW_NUMBER() OVER (ORDER BY id) AS visit_order
    FROM ranked_destinations
    WHERE province_rank = 1
    ORDER BY id
    LIMIT 3
), bangkok_today AS (
    SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date AS value
)
INSERT INTO travel_diary_entries (
    external_id,
    user_id,
    destination_id,
    started_at,
    last_seen_at,
    source
)
SELECT
    'imported_' || destination.id,
    target_user.id,
    destination.id,
    (
        bangkok_today.value - ((4 - destination.visit_order) * INTERVAL '1 day')
        + INTERVAL '10 hours 30 minutes'
    ) AT TIME ZONE 'Asia/Bangkok',
    (
        bangkok_today.value - ((4 - destination.visit_order) * INTERVAL '1 day')
        + INTERVAL '12 hours 30 minutes'
    ) AT TIME ZONE 'Asia/Bangkok',
    'imported'
FROM target_user
CROSS JOIN selected_destinations destination
CROSS JOIN bangkok_today
ON CONFLICT (user_id, external_id) DO NOTHING;
