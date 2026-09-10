// server/controllers/mobileController.js

const pool = require('../config/db');
const { resolveTatLanguage } = require('../utils/tatLanguage');
const destinationRepository = require('../repositories/destinationRepository');

// อ่านภาษาที่ผู้ใช้ร้องขอจาก Accept-Language
const requestLanguage = (req) => resolveTatLanguage(
    typeof req.get === 'function'
        ? req.get('Accept-Language')
        : req.headers?.['accept-language'],
);

// เลือกข้อความตอบกลับภาษาไทยหรืออังกฤษตามภาษาของ request
const localizedMessage = (language, thai, english) =>
    language === 'en' ? english : thai;

// แจ้ง cache ว่า response แตกต่างกันตาม Accept-Language
const addLanguageVaryHeader = (res) => {
    if (typeof res.vary === 'function') res.vary('Accept-Language');
};

// สร้าง controller สำหรับ mobile โดยรับ database เพื่อทดสอบหรือสลับ dependency ได้
const createMobileControllers = (database) => {
    // คืนรายการสถานที่ approved พร้อมคำแปลตามภาษาที่ร้องขอ
    const getDestinations = async (req, res) => {
        const language = requestLanguage(req);
        try {
            const parsedLimit = Number.parseInt(req.query.limit, 10);
            const limit = Number.isInteger(parsedLimit) && parsedLimit > 0
                ? Math.min(parsedLimit, 200)
                : null;

            const rows = await destinationRepository.findApprovedDestinations(
                language,
                limit,
                database,
            );
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
                    provinceValue: row.province_value || province,
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

    // คืนเฉพาะจังหวัดที่มีสถานที่ approved เพื่อใช้เป็นตัวเลือกสร้างแผน
    // value เป็นชื่อจังหวัดหลักใน DB สำหรับ filter ส่วน label แปลตามภาษาหน้าจอ
    const getProvinces = async (req, res) => {
        const language = requestLanguage(req);
        try {
            const rows = await destinationRepository.findApprovedProvinces(language, database);

            addLanguageVaryHeader(res);
            res.json({
                data: rows.map(row => ({
                    value: row.value,
                    label: row.label || row.value,
                    destinationCount: Number(row.destination_count) || 0,
                })),
                language,
            });
        } catch (err) {
            console.error('[mobileController] provinces error:', err);
            res.status(500).json({
                message: localizedMessage(
                    language,
                    'เกิดข้อผิดพลาดในการดึงข้อมูลจังหวัด',
                    'Unable to load provinces',
                ),
            });
        }
    };

    // คืนรายละเอียดสถานที่ approved หนึ่งแห่งพร้อมคำแปลตามภาษา
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

            const destination = await destinationRepository.findApprovedDestinationDetail(
                destinationId,
                language,
                database,
            );
            if (!destination) {
                return res.status(404).json({
                    message: localizedMessage(
                        language,
                        'ไม่พบสถานที่',
                        'Destination not found',
                    ),
                });
            }

            const storedImageUrls = await destinationRepository.findDestinationImageUrls(
                destinationId,
                database,
            );
            const jsonImages = Array.isArray(destination.images)
                ? destination.images.map((image) =>
                    typeof image === 'string' ? image : image?.image_url || image?.url,
                )
                : [];
            const imageUrls = [...new Set([
                destination.image_url,
                ...jsonImages,
                ...storedImageUrls,
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

    return { getDestinations, getProvinces, getDestinationDetail };
};

const { getDestinations, getProvinces, getDestinationDetail } = createMobileControllers(pool);

module.exports = {
    createMobileControllers,
    getDestinations,
    getProvinces,
    getDestinationDetail,
};
