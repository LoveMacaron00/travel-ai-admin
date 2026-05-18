-- Smart Travel Planner - Database Initialization Script
-- ใช้แทน Prisma schema สำหรับสร้างตารางในฐานข้อมูล PostgreSQL

-- เปิดใช้งาน pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================
-- ตาราง admins (ผู้ดูแลระบบ)
-- ============================================
CREATE TABLE IF NOT EXISTS admins (
    id         SERIAL PRIMARY KEY,
    email      VARCHAR(255) UNIQUE NOT NULL,
    password   VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ตาราง users (ผู้ใช้งาน)
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id                  SERIAL PRIMARY KEY,
    email               VARCHAR(255) UNIQUE,
    hash_password       VARCHAR(255),
    username            VARCHAR(255),
    interests           JSONB,
    is_private_location BOOLEAN DEFAULT FALSE,
    is_banned           BOOLEAN DEFAULT FALSE,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ตาราง feedback (ข้อเสนอแนะ)
-- ============================================
CREATE TABLE IF NOT EXISTS feedback (
    id          SERIAL PRIMARY KEY,
    user_id     INT REFERENCES users(id),
    message     TEXT NOT NULL,
    status      VARCHAR(50) DEFAULT 'pending',
    admin_reply TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ตาราง destinations (สถานที่ท่องเที่ยว)
-- ============================================
CREATE TABLE IF NOT EXISTS destinations (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(255) NOT NULL,
    province     VARCHAR(255),
    description  TEXT,
    latitude     DOUBLE PRECISION,
    longitude    DOUBLE PRECISION,
    opening_time VARCHAR(20) DEFAULT '00:00 AM',
    closing_time VARCHAR(20) DEFAULT '00:00 PM',
    category     VARCHAR(100) DEFAULT 'General',
    status       VARCHAR(50) DEFAULT 'published',
    source       VARCHAR(50) DEFAULT 'admin',
    image_url    TEXT,
    embedding    vector(1536),
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ตาราง destination_images (รูปภาพสถานที่)
-- ============================================
CREATE TABLE IF NOT EXISTS destination_images (
    id             SERIAL PRIMARY KEY,
    destination_id INT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    image_url      TEXT NOT NULL,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_destination_images_dest_id ON destination_images(destination_id);
CREATE INDEX IF NOT EXISTS idx_destinations_source ON destinations(source);
CREATE INDEX IF NOT EXISTS idx_destinations_status ON destinations(status);
