const pool = require('../config/db');
const { resolveTatLanguage } = require('./helpers/tatLanguage');

const allowedSources = new Set(['manual', 'gps', 'aiCamera', 'imported']);

const requestLanguage = (req) => resolveTatLanguage(
    typeof req.get === 'function'
        ? req.get('Accept-Language')
        : req.headers?.['accept-language'],
);

const stringValue = (value, maxLength) => {
    if (value === undefined || value === null) return '';
    return String(value).trim().slice(0, maxLength);
};

const nullableNumber = (value, minimum, maximum) => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
        throw new TypeError('invalid-number');
    }
    return parsed;
};

const parseEntry = (body = {}) => {
    const externalId = stringValue(body.id, 100);
    const startedAt = new Date(body.date);
    const lastSeenAt = body.lastSeenAt ? new Date(body.lastSeenAt) : null;
    const destinationId = body.destinationId === undefined || body.destinationId === null
        ? null
        : Number(body.destinationId);
    const source = stringValue(body.source || 'manual', 30);
    const imageUrls = Array.isArray(body.imageUrls)
        ? body.imageUrls
            .map((url) => stringValue(url, 2048))
            .filter((url) => url.startsWith('/') || /^https?:\/\//i.test(url))
            .slice(0, 8)
        : [];

    if (!externalId || Number.isNaN(startedAt.getTime())) {
        throw new TypeError('invalid-entry');
    }
    if (lastSeenAt && Number.isNaN(lastSeenAt.getTime())) {
        throw new TypeError('invalid-entry');
    }
    if (destinationId !== null && (!Number.isInteger(destinationId) || destinationId <= 0)) {
        throw new TypeError('invalid-entry');
    }
    if (!allowedSources.has(source)) throw new TypeError('invalid-entry');

    return {
        externalId,
        destinationId,
        startedAt,
        lastSeenAt,
        title: stringValue(body.title, 500),
        note: stringValue(body.note, 10000),
        province: stringValue(body.province, 255),
        insight: stringValue(body.insight, 10000),
        imageUrls,
        latitude: nullableNumber(body.latitude, -90, 90),
        longitude: nullableNumber(body.longitude, -180, 180),
        source,
    };
};

const createTravelDiaryController = (database) => {
    const getEntries = async (req, res) => {
        const language = requestLanguage(req);
        try {
            const { rows } = await database.query(
                `SELECT
                    entry.external_id AS id,
                    entry.started_at AS date,
                    entry.last_seen_at,
                    COALESCE(
                        NULLIF(entry.title, ''),
                        CASE WHEN $2 = 'th' THEN destination.name ELSE translation.name END,
                        destination.name,
                        ''
                    ) AS title,
                    entry.note,
                    COALESCE(
                        NULLIF(entry.province, ''),
                        CASE WHEN $2 = 'th' THEN destination.province ELSE translation.province END,
                        destination.province,
                        ''
                    ) AS province,
                    COALESCE(
                        NULLIF(entry.insight, ''),
                        CASE WHEN $2 = 'th' THEN destination.description ELSE translation.description END,
                        destination.description,
                        ''
                    ) AS insight,
                    CASE
                        WHEN jsonb_array_length(entry.image_urls) > 0 THEN entry.image_urls
                        WHEN NULLIF(destination.image_url, '') IS NOT NULL
                            THEN jsonb_build_array(destination.image_url)
                        ELSE '[]'::jsonb
                    END AS image_urls,
                    COALESCE(entry.latitude, destination.latitude) AS latitude,
                    COALESCE(entry.longitude, destination.longitude) AS longitude,
                    entry.destination_id,
                    entry.source
                 FROM travel_diary_entries entry
                 LEFT JOIN destinations destination
                    ON destination.id = entry.destination_id
                 LEFT JOIN destination_translations translation
                    ON translation.destination_id = destination.id
                   AND translation.language_code = $2
                 WHERE entry.user_id = $1
                 ORDER BY entry.started_at DESC, entry.id DESC`,
                [req.user.id, language],
            );
            res.vary('Accept-Language');
            return res.json({ data: rows });
        } catch (error) {
            console.error('[travelDiaryController] getEntries:', error.message);
            return res.status(500).json({ message: 'ไม่สามารถโหลดบันทึกการเดินทางได้' });
        }
    };

    const upsertEntry = async (req, res) => {
        let entry;
        try {
            entry = parseEntry(req.body);
        } catch {
            return res.status(400).json({ message: 'ข้อมูลบันทึกการเดินทางไม่ถูกต้อง' });
        }

        try {
            const { rows } = await database.query(
                `INSERT INTO travel_diary_entries (
                    external_id, user_id, destination_id, started_at, last_seen_at,
                    title, note, province, insight, image_urls,
                    latitude, longitude, source
                 ) VALUES (
                    $1, $2, $3, $4, $5,
                    $6, $7, $8, $9, $10::jsonb,
                    $11, $12, $13
                 )
                 ON CONFLICT (user_id, external_id) DO UPDATE SET
                    destination_id = EXCLUDED.destination_id,
                    started_at = EXCLUDED.started_at,
                    last_seen_at = EXCLUDED.last_seen_at,
                    title = EXCLUDED.title,
                    note = EXCLUDED.note,
                    province = EXCLUDED.province,
                    insight = EXCLUDED.insight,
                    image_urls = EXCLUDED.image_urls,
                    latitude = EXCLUDED.latitude,
                    longitude = EXCLUDED.longitude,
                    source = EXCLUDED.source,
                    updated_at = NOW()
                 RETURNING external_id AS id`,
                [
                    entry.externalId,
                    req.user.id,
                    entry.destinationId,
                    entry.startedAt,
                    entry.lastSeenAt,
                    entry.title,
                    entry.note,
                    entry.province,
                    entry.insight,
                    JSON.stringify(entry.imageUrls),
                    entry.latitude,
                    entry.longitude,
                    entry.source,
                ],
            );
            return res.status(200).json({ entry: rows[0] });
        } catch (error) {
            if (error.code === '23503') {
                return res.status(400).json({ message: 'ไม่พบสถานที่ที่อ้างอิง' });
            }
            console.error('[travelDiaryController] upsertEntry:', error.message);
            return res.status(500).json({ message: 'ไม่สามารถบันทึกการเดินทางได้' });
        }
    };

    const deleteEntry = async (req, res) => {
        const externalId = stringValue(req.params.externalId, 100);
        if (!externalId) return res.status(400).json({ message: 'รหัสบันทึกไม่ถูกต้อง' });
        try {
            const result = await database.query(
                `DELETE FROM travel_diary_entries
                 WHERE user_id = $1 AND external_id = $2`,
                [req.user.id, externalId],
            );
            if (result.rowCount === 0) {
                return res.status(404).json({ message: 'ไม่พบบันทึกการเดินทาง' });
            }
            return res.json({ deleted: true });
        } catch (error) {
            console.error('[travelDiaryController] deleteEntry:', error.message);
            return res.status(500).json({ message: 'ไม่สามารถลบบันทึกการเดินทางได้' });
        }
    };

    const uploadImage = (req, res) => {
        if (!req.file) {
            return res.status(400).json({ message: 'ไม่พบไฟล์ที่อัปโหลด' });
        }
        const url = `/uploads/${req.file.filename}`;
        // รองรับทั้ง {url} และ {data:{url}} เพื่อให้ client รุ่นเก่า/ใหม่ใช้งานได้
        return res.json({ url, data: { url } });
    };

    return { getEntries, upsertEntry, deleteEntry, uploadImage };
};

module.exports = {
    createTravelDiaryController,
    ...createTravelDiaryController(pool),
};
