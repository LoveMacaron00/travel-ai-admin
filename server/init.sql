-- =============================================================
-- Smart Travel Planner — Database Initialization Script
-- =============================================================
-- ลำดับการสร้าง:
--   1. Extensions
--   2. ENUM types
--   3. Core tables  (admins, users)
--   4. Places layer (destinations, destination_images, place_embeddings)
--   5. AI layer     (trips, trip_plans, chat_sessions, chat_messages)
--   6. Support      (feedback)
--   7. Indexes
-- =============================================================

-- -------------------------------------------------------------
-- 1. Extensions
-- -------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -------------------------------------------------------------
-- 2. ENUM types
-- -------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE place_source AS ENUM ('tat', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE place_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE chat_role AS ENUM ('user', 'assistant');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE trip_status AS ENUM ('generating', 'done', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -------------------------------------------------------------
-- 3. Core tables
-- -------------------------------------------------------------

-- admins
CREATE TABLE IF NOT EXISTS admins (
    id         SERIAL PRIMARY KEY,
    email      VARCHAR(255) UNIQUE NOT NULL,
    password   VARCHAR(255)        NOT NULL,
    role       VARCHAR(50)         NOT NULL DEFAULT 'admin', -- 'superadmin' | 'admin'
    created_at TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

-- users
CREATE TABLE IF NOT EXISTS users (
    id                  SERIAL      PRIMARY KEY,
    email               VARCHAR(255) UNIQUE,
    hash_password       VARCHAR(255),
    username            VARCHAR(255),
    profile_image_url   TEXT,
    interests           JSONB,                          -- ['beach','food','history']
    is_banned           BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------------
-- 4. Places layer
-- -------------------------------------------------------------

-- destinations  (unified — รวม TAT + Admin + User ไว้ที่เดียว)
CREATE TABLE IF NOT EXISTS destinations (
    id          SERIAL PRIMARY KEY,

    -- ข้อมูลหลัก
    name        VARCHAR(255) NOT NULL,
    province    VARCHAR(255),
    description TEXT,
    category    VARCHAR(100) NOT NULL DEFAULT 'general',
    tags        TEXT[]       NOT NULL DEFAULT '{}',     -- ['ธรรมชาติ','ครอบครัว']

    -- ที่ตั้ง
    latitude    DOUBLE PRECISION,
    longitude   DOUBLE PRECISION,
    address     TEXT,

    -- เวลาทำการ
    opening_time VARCHAR(20) DEFAULT '00:00',
    closing_time VARCHAR(20) DEFAULT '00:00',
    opening_hours JSONB,                               -- raw array จาก TAT [{day,open,close}]

    -- รูปภาพ
    image_url   TEXT,                                  -- cover image
    images      JSONB        NOT NULL DEFAULT '[]',    -- [{url, caption, is_cover}]

    -- source & status
    source      place_source NOT NULL DEFAULT 'admin',
    status      place_status NOT NULL DEFAULT 'pending',

    -- TAT integration
    tat_place_id VARCHAR(100) UNIQUE,                  -- TAT placeId ป้องกัน sync ซ้ำ
    tat_raw      JSONB,                                -- raw response จาก TAT เก็บไว้เต็ม

    -- Admin override (ป้องกัน TAT sync ทับงาน admin)
    override_name        VARCHAR(255),
    override_description TEXT,

    -- ค่าเข้าชม
    price_adult  NUMERIC(10,2),
    price_child  NUMERIC(10,2),

    -- สถิติ
    avg_rating   NUMERIC(3,2) DEFAULT 0,
    review_count INT          NOT NULL DEFAULT 0,

    -- approval tracking
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- destination_images  (gallery)
CREATE TABLE IF NOT EXISTS destination_images (
    id             SERIAL PRIMARY KEY,
    destination_id INT  NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    image_url      TEXT NOT NULL,
    caption        TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- place_embeddings  (หัวใจ RAG — แยกออกจาก destinations)
-- 1 destination → 3 rows (name_tags / description / location_context)
CREATE TABLE IF NOT EXISTS place_embeddings (
    id           SERIAL PRIMARY KEY,
    destination_id INT  NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    chunk_text   TEXT NOT NULL,
    chunk_field  VARCHAR(50) NOT NULL, -- 'name_tags' | 'description' | 'location_context'
    embedding    vector(1536),
    embedded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------------
-- 5. AI layer
-- -------------------------------------------------------------

-- trips  (คำขอสร้างแผนเที่ยวของ user)
CREATE TABLE IF NOT EXISTS trips (
    id           SERIAL PRIMARY KEY,
    user_id      INT         REFERENCES users(id) ON DELETE SET NULL,

    -- input จาก user
    destination  VARCHAR(255) NOT NULL,
    province     VARCHAR(255),
    days         INT          NOT NULL DEFAULT 3,
    budget       NUMERIC(12,2),
    currency     VARCHAR(10)  NOT NULL DEFAULT 'THB',
    travel_style VARCHAR(50),                         -- 'backpacker'|'comfort'|'luxury'
    group_type   VARCHAR(50),                         -- 'solo'|'couple'|'family'|'friends'
    interests    JSONB        NOT NULL DEFAULT '[]',  -- ['food','history','beach']

    status       trip_status  NOT NULL DEFAULT 'generating',
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- trip_plans  (แผนเที่ยวที่ AI สร้าง)
CREATE TABLE IF NOT EXISTS trip_plans (
    id              SERIAL PRIMARY KEY,
    trip_id         INT  NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    plan_data       JSONB,          -- structured JSON จาก Claude
    markdown_cache  TEXT,           -- markdown สำหรับ Flutter render
    version         INT  NOT NULL DEFAULT 1,
    generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- chat_sessions  (1 session ต่อ 1 trip)
CREATE TABLE IF NOT EXISTS chat_sessions (
    id         SERIAL PRIMARY KEY,
    user_id    INT REFERENCES users(id)  ON DELETE SET NULL,
    trip_id    INT REFERENCES trips(id)  ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- chat_messages  (ประวัติการสนทนา RAG)
CREATE TABLE IF NOT EXISTS chat_messages (
    id               SERIAL PRIMARY KEY,
    session_id       INT         NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role             chat_role   NOT NULL,
    content          TEXT        NOT NULL,
    source_chunk_ids INT[]       NOT NULL DEFAULT '{}', -- place_embeddings.id ที่ RAG ดึงมา
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------------
-- 6. Support tables
-- -------------------------------------------------------------

-- feedback
CREATE TABLE IF NOT EXISTS feedback (
    id          SERIAL PRIMARY KEY,
    user_id     INT  REFERENCES users(id) ON DELETE SET NULL,
    message     TEXT NOT NULL,
    status      VARCHAR(50)  NOT NULL DEFAULT 'pending',
    admin_reply TEXT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------------
-- 7. Indexes
-- -------------------------------------------------------------

-- destinations
CREATE INDEX IF NOT EXISTS idx_dest_source       ON destinations(source);
CREATE INDEX IF NOT EXISTS idx_dest_status       ON destinations(status);
CREATE INDEX IF NOT EXISTS idx_dest_province     ON destinations(province);
CREATE INDEX IF NOT EXISTS idx_dest_category     ON destinations(category);
CREATE INDEX IF NOT EXISTS idx_dest_tat_place_id ON destinations(tat_place_id);

-- place_embeddings — HNSW cosine (เร็วกว่า IVFFlat สำหรับ < 5M rows)
CREATE INDEX IF NOT EXISTS idx_place_emb_hnsw
    ON place_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_place_emb_dest_id ON place_embeddings(destination_id);

-- destination_images
CREATE INDEX IF NOT EXISTS idx_dest_images_dest_id ON destination_images(destination_id);

-- trips & plans
CREATE INDEX IF NOT EXISTS idx_trips_user_id     ON trips(user_id);
CREATE INDEX IF NOT EXISTS idx_trip_plans_trip   ON trip_plans(trip_id);

-- chat
CREATE INDEX IF NOT EXISTS idx_chat_sessions_trip ON chat_sessions(trip_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sess ON chat_messages(session_id);

-- feedback
CREATE INDEX IF NOT EXISTS idx_feedback_user_id  ON feedback(user_id);
