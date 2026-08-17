-- =============================================================
-- Plan Preference Options — ตัวเลือกความสนใจและรูปแบบการเดินทาง
-- =============================================================
-- ตัวเลือกที่ใช้ในหน้าสร้างแผนเที่ยวของแอปมือถือ:
--   - interest       : "คุณชอบอะไร" (อาหาร, คาเฟ่, ธรรมชาติ, ...)
--   - transport_mode : "คุณเดินทางแบบใดได้บ้าง" (รถยนต์, เดิน, ...)
-- Admin จัดการผ่านหน้า "ตัวเลือกแผน" ใน travel-ai-admin
-- แอปมือถือดึงค่าที่ใช้งานจาก GET /api/mobile/plan-options
-- =============================================================

CREATE TABLE IF NOT EXISTS plan_preference_options (
    id SERIAL PRIMARY KEY,
    type VARCHAR(20) NOT NULL CHECK (type IN ('interest', 'transport_mode')),
    key VARCHAR(50) NOT NULL,          -- ค่าที่ส่งเข้า AI เช่น 'food', 'car'
    label_th VARCHAR(100) NOT NULL,    -- ชื่อภาษาไทย เช่น 'อาหาร'
    label_en VARCHAR(100) NOT NULL,    -- ชื่อภาษาอังกฤษ เช่น 'Food'
    icon VARCHAR(50),                  -- ไอคอนพาหนะสำหรับ transport_mode ('car','walking','bus','train','ferry','flight')
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT plan_preference_options_type_key_unique UNIQUE (type, key)
);

-- seed ค่าเริ่มต้นตามหน้าจอแอป (ไม่ทับรายการที่แก้ไขไปแล้ว)
INSERT INTO plan_preference_options (type, key, label_th, label_en, icon, sort_order) VALUES
    ('interest',       'food',      'อาหาร',        'Food',       NULL,     1),
    ('interest',       'cafe',      'คาเฟ่',        'Cafe',       NULL,     2),
    ('interest',       'nature',    'ธรรมชาติ',     'Nature',     NULL,     3),
    ('interest',       'beach',     'ชายหาด',       'Beach',      NULL,     4),
    ('interest',       'temple',    'วัด',           'Temple',     NULL,     5),
    ('interest',       'adventure', 'ผจญภัย',       'Adventure',  NULL,     6),
    ('interest',       'shopping',  'ชอปปิง',       'Shopping',   NULL,     7),
    ('interest',       'nightlife', 'ชีวิตกลางคืน', 'Nightlife',  NULL,     8),
    ('interest',       'culture',   'วัฒนธรรม',     'Culture',    NULL,     9),
    ('transport_mode', 'car',       'รถยนต์',       'Car',        'car',     1),
    ('transport_mode', 'walking',   'เดิน',         'Walking',    'walking', 2),
    ('transport_mode', 'bus',       'รถโดยสาร',     'Bus',        'bus',     3),
    ('transport_mode', 'train',     'รถไฟ',         'Train',      'train',   4),
    ('transport_mode', 'ferry',     'เรือ',         'Ferry',      'ferry',   5),
    ('transport_mode', 'flight',    'เครื่องบิน',   'Flight',     'flight',  6)
ON CONFLICT (type, key) DO NOTHING;

-- ดึงรายการเรียงตามลำดับที่ต้องการใช้บ่อย
CREATE INDEX IF NOT EXISTS idx_plan_preference_options_type
    ON plan_preference_options(type, sort_order ASC);
