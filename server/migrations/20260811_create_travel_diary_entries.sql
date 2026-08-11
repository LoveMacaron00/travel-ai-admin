CREATE TABLE IF NOT EXISTS travel_diary_entries (
    id BIGSERIAL PRIMARY KEY,
    external_id VARCHAR(100) NOT NULL,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    destination_id INT REFERENCES destinations(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ,
    title TEXT,
    note TEXT NOT NULL DEFAULT '',
    province VARCHAR(255),
    insight TEXT,
    image_urls JSONB NOT NULL DEFAULT '[]',
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    source VARCHAR(30) NOT NULL DEFAULT 'manual',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT travel_diary_external_id_per_user UNIQUE (user_id, external_id),
    CONSTRAINT travel_diary_image_urls_array CHECK (jsonb_typeof(image_urls) = 'array'),
    CONSTRAINT travel_diary_source CHECK (source IN ('manual', 'gps', 'aiCamera', 'imported'))
);

CREATE INDEX IF NOT EXISTS idx_travel_diary_user_started
    ON travel_diary_entries(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_travel_diary_destination
    ON travel_diary_entries(destination_id);
