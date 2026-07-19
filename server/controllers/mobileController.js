// server/controllers/mobileController.js

const pool = require('../config/db');
const { resolveTatLanguage } = require('./helpers/tatLanguage');

const requestLanguage = (req) => resolveTatLanguage(
    typeof req.get === 'function'
        ? req.get('Accept-Language')
        : req.headers?.['accept-language'],
);

const localizedMessage = (language, thai, english) =>
    language === 'en' ? english : thai;

const addLanguageVaryHeader = (res) => {
    if (typeof res.vary === 'function') res.vary('Accept-Language');
};

const createMobileControllers = (database) => {
    const getDestinations = async (req, res) => {
        const language = requestLanguage(req);
        try {
            const parsedLimit = Number.parseInt(req.query.limit, 10);
            const limit = Number.isInteger(parsedLimit) && parsedLimit > 0
                ? Math.min(parsedLimit, 200)
                : null;
            const params = [language];

            let sql = `
                SELECT
                    d.id,
                    COALESCE(
                        CASE WHEN $1 = 'th' THEN d.name ELSE preferred.name END,
                        d.name
                    ) AS name,
                    COALESCE(
                        CASE WHEN $1 = 'th' THEN d.province ELSE preferred.province END,
                        d.province
                    ) AS province,
                    COALESCE(
                        CASE WHEN $1 = 'th' THEN d.district ELSE preferred.district END,
                        d.district
                    ) AS district,
                    COALESCE(
                        CASE WHEN $1 = 'th' THEN d.sub_district ELSE preferred.sub_district END,
                        d.sub_district
                    ) AS sub_district,
                    COALESCE(
                        CASE WHEN $1 = 'th' THEN d.description ELSE preferred.description END,
                        d.description
                    ) AS description,
                    d.latitude,
                    d.longitude,
                    d.image_url AS image,
                    d.category,
                    (
                        SELECT COUNT(*)::int
                        FROM destination_view_events view_events
                        WHERE view_events.destination_id = d.id
                    ) AS viewer
                FROM destinations d
                LEFT JOIN destination_translations preferred
                    ON preferred.destination_id = d.id
                   AND preferred.language_code = $1
                WHERE d.status = 'approved'
                  AND d.latitude IS NOT NULL
                  AND d.longitude IS NOT NULL
                ORDER BY d.created_at DESC
            `;

            if (limit) {
                params.push(limit);
                sql += ` LIMIT $${params.length}`;
            }

            const { rows } = await database.query(sql, params);
            const fallbackCountry = language === 'en' ? 'Thailand' : 'ประเทศไทย';
            const data = rows.map((row) => {
                const province = row.province || fallbackCountry;
                const location = [row.sub_district, row.district, province]
                    .filter(Boolean)
                    .join(', ');
                return {
                    id: row.id,
                    name: row.name,
                    city: province,
                    location,
                    province,
                    district: row.district || '',
                    sub_district: row.sub_district || '',
                    description: row.description || '',
                    latitude: row.latitude,
                    longitude: row.longitude,
                    image: row.image || '',
                    category: row.category || 'general',
                    viewer: row.viewer || 0,
                };
            });

            addLanguageVaryHeader(res);
            res.json({ data, language });
        } catch (err) {
            console.error('[mobileController] destinations error:', err);
            res.status(500).json({
                message: localizedMessage(
                    language,
                    'เกิดข้อผิดพลาดในการดึงข้อมูลสถานที่',
                    'Unable to load destinations',
                ),
            });
        }
    };

    const getDestinationDetail = async (req, res) => {
        const language = requestLanguage(req);
        try {
            const destinationId = Number.parseInt(req.params.id, 10);
            if (!Number.isInteger(destinationId)) {
                return res.status(400).json({
                    message: localizedMessage(
                        language,
                        'รหัสสถานที่ไม่ถูกต้อง',
                        'Invalid destination id',
                    ),
                });
            }

            const { rows } = await database.query(
                `SELECT
                    d.id,
                    COALESCE(
                        CASE WHEN $2 = 'th' THEN d.name ELSE preferred.name END,
                        d.name
                    ) AS name,
                    d.province_id,
                    COALESCE(
                        CASE WHEN $2 = 'th' THEN d.province ELSE preferred.province END,
                        d.province
                    ) AS province,
                    d.district_id,
                    COALESCE(
                        CASE WHEN $2 = 'th' THEN d.district ELSE preferred.district END,
                        d.district
                    ) AS district,
                    d.sub_district_id,
                    COALESCE(
                        CASE WHEN $2 = 'th' THEN d.sub_district ELSE preferred.sub_district END,
                        d.sub_district
                    ) AS sub_district,
                    COALESCE(
                        CASE WHEN $2 = 'th' THEN d.postcode ELSE preferred.postcode END,
                        d.postcode
                    ) AS postcode,
                    COALESCE(
                        CASE WHEN $2 = 'th' THEN d.description ELSE preferred.description END,
                        d.description
                    ) AS description,
                    COALESCE(
                        CASE WHEN $2 = 'th' THEN d.address ELSE preferred.address END,
                        d.address
                    ) AS address,
                    COALESCE(
                        CASE WHEN $2 = 'th' THEN d.tags ELSE preferred.tags END,
                        d.tags
                    ) AS tags,
                    d.category,
                    d.image_url,
                    d.images,
                    d.opening_time,
                    d.closing_time,
                    COALESCE(
                        CASE WHEN $2 = 'th' THEN d.opening_hours ELSE preferred.opening_hours END,
                        d.opening_hours
                    ) AS opening_hours,
                    COALESCE(
                        CASE WHEN $2 = 'th' THEN d.admission_fee ELSE preferred.admission_fee END,
                        d.admission_fee
                    ) AS admission_fee,
                    COALESCE(
                        CASE WHEN $2 = 'th' THEN d.tat_raw ELSE preferred.tat_raw END,
                        d.tat_raw
                    ) AS tat_raw
                 FROM destinations d
                 LEFT JOIN destination_translations preferred
                    ON preferred.destination_id = d.id
                   AND preferred.language_code = $2
                 WHERE d.id = $1 AND d.status = 'approved'`,
                [destinationId, language],
            );
            const destination = rows[0];
            if (!destination) {
                return res.status(404).json({
                    message: localizedMessage(
                        language,
                        'ไม่พบสถานที่',
                        'Destination not found',
                    ),
                });
            }

            const { rows: imageRows } = await database.query(
                `SELECT image_url FROM destination_images
                 WHERE destination_id = $1 ORDER BY id ASC`,
                [destinationId],
            );
            const jsonImages = Array.isArray(destination.images)
                ? destination.images.map((image) =>
                    typeof image === 'string' ? image : image?.image_url || image?.url,
                )
                : [];
            const imageUrls = [...new Set([
                destination.image_url,
                ...jsonImages,
                ...imageRows.map((image) => image.image_url),
            ].filter(Boolean))];

            addLanguageVaryHeader(res);
            res.json({
                ...destination,
                language,
                location: {
                    address: destination.address,
                    province: {
                        provinceId: destination.province_id,
                        name: destination.province,
                    },
                    district: {
                        districtId: destination.district_id,
                        name: destination.district,
                    },
                    subDistrict: {
                        subDistrictId: destination.sub_district_id,
                        name: destination.sub_district,
                    },
                    postcode: destination.postcode,
                },
                images: imageUrls.map((image_url) => ({ image_url })),
            });
        } catch (err) {
            console.error('[mobileController] destination detail error:', err);
            res.status(500).json({
                message: localizedMessage(
                    language,
                    'เกิดข้อผิดพลาดในการดึงรายละเอียดสถานที่',
                    'Unable to load destination details',
                ),
            });
        }
    };

    return { getDestinations, getDestinationDetail };
};

const { getDestinations, getDestinationDetail } = createMobileControllers(pool);

module.exports = {
    getDestinations,
    getDestinationDetail,
    createMobileControllers,
    requestLanguage,
};
