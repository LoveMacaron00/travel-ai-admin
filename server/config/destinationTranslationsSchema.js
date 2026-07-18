const pool = require('./db');

/**
 * เพิ่มชั้นข้อมูลหลายภาษาโดยไม่แก้ destination id หรือทำลายข้อมูลเดิม
 * ภาษาไทยอยู่ใน destinations ซึ่งเป็น source of truth เดิม ตารางนี้จึงเก็บ
 * เฉพาะภาษาที่แปลเพิ่ม และปัจจุบันรองรับภาษาอังกฤษ
 */
const ensureDestinationTranslationsSchema = async (database = pool) => {
    await database.query(`
        CREATE TABLE IF NOT EXISTS destination_translations (
            destination_id INT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
            language_code VARCHAR(5) NOT NULL,
            name VARCHAR(255) NOT NULL,
            province VARCHAR(255),
            description TEXT,
            address TEXT,
            tags TEXT[] NOT NULL DEFAULT '{}',
            opening_hours JSONB,
            admission_fee JSONB NOT NULL DEFAULT '{}',
            tat_raw JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (destination_id, language_code),
            CONSTRAINT destination_translation_language
                CHECK (language_code = 'en')
        )
    `);

    await database.query(`
        DELETE FROM destination_translations
        WHERE language_code = 'th'
    `);

    await database.query(`
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conrelid = 'destination_translations'::regclass
                  AND conname = 'destination_translation_language'
                  AND pg_get_constraintdef(oid) LIKE '%language_code%en%'
                  AND pg_get_constraintdef(oid) NOT LIKE '%th%'
            ) THEN
                ALTER TABLE destination_translations
                    DROP CONSTRAINT IF EXISTS destination_translation_language;
                ALTER TABLE destination_translations
                    ADD CONSTRAINT destination_translation_language
                    CHECK (language_code = 'en');
            END IF;
        END $$
    `);

    await database.query(`
        CREATE INDEX IF NOT EXISTS idx_destination_translations_language
        ON destination_translations(language_code, destination_id)
    `);
};

module.exports = { ensureDestinationTranslationsSchema };
