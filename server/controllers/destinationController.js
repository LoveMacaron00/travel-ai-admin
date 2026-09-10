// server/controllers/destinationController.js

const fs = require('fs');
const path = require('path');
const { embedDestination, clearDestinationEmbedding } = require('../services/embedHelper');
const destinationRepository = require('../repositories/destinationRepository');
const {
    normalizePlaceStatus,
    normalizeAdminPlaceCategory,
    normalizeImageUrls,
    normalizeStoredImages,
    normalizeAdmissionFee,
    nullableText,
    nullableLocationId,
    normalizeLocationInput,
    getRemovedImages,
    validateCoordinates,
} = require('../validators/destinationValidator');

// การบันทึกสถานที่ต้องสำเร็จได้แม้บริการ embedding ภายนอกขัดข้อง
// โดยส่งคำเตือนกลับให้หน้า Admin แทนการรายงานว่าบันทึกข้อมูลล้มเหลว
const refreshDestinationEmbedding = async (destinationId, status) => {
    try {
        if (normalizePlaceStatus(status) === 'approved') {
            await embedDestination(destinationId);
        } else {
            await clearDestinationEmbedding(destinationId);
        }
        return null;
    } catch (err) {
        console.error(`[destination] embedding destination ${destinationId} error:`, err.message);
        return 'บันทึกสถานที่สำเร็จ แต่สร้างข้อมูลค้นหาสำหรับ AI ไม่สำเร็จ กรุณาลองสร้าง embedding ใหม่ภายหลัง';
    }
};

// ลบไฟล์จริงจาก /uploads (เฉพาะไฟล์ที่อยู่ใน /uploads เท่านั้น)
// ลบไฟล์รูปที่ไม่ถูกอ้างอิงแล้วจากโฟลเดอร์ upload
const deleteUploadedFiles = (imagePaths) => {
    for (const imgPath of imagePaths) {
        if (!imgPath) continue;
        if (!imgPath.startsWith('/uploads/')) continue;

        const filename = path.basename(imgPath);
        const fullPath = path.join(__dirname, '..', 'uploads', filename);
        fs.unlink(fullPath, (err) => {
            if (err && err.code !== 'ENOENT') {
                console.error('[deleteUploadedFiles] error:', fullPath, err.message);
            }
        });
    }
};

const parseLatitude = (value) => (value !== '' && value != null ? parseFloat(value) : null);

/**
 * ดึงรายการสถานที่ทั้งหมด (รองรับตัวกรอง)
 * GET /api/destinations
 */
// ส่งรายการสถานที่ทั้งหมดสำหรับหน้า admin พร้อมตัวกรองและ pagination
const getAllDestinations = async (req, res) => {
    try {
        const { province, status, search, source } = req.query;
        const paginationRequested = req.query.page !== undefined || req.query.limit !== undefined;
        const parsedPage = Number.parseInt(req.query.page, 10);
        const parsedLimit = Number.parseInt(req.query.limit, 10);
        const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
        const limit = Number.isSafeInteger(parsedLimit) && parsedLimit > 0
            ? Math.min(parsedLimit, 100)
            : 10;

        const result = await destinationRepository.searchAdminDestinations({
            source,
            province,
            search,
            status,
            page,
            limit,
            paginationRequested,
        });
        return res.json(result);
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการดึงรายการสถานที่:', err);
        res.status(500).json({ message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" });
    }
};

/**
 * ดึงข้อมูลสถานที่ตาม ID พร้อมรูปภาพ
 * GET /api/destinations/:id
 */
// ส่งรายละเอียดสถานที่หนึ่งแห่งสำหรับหน้าแก้ไขของ admin
const getDestinationById = async (req, res) => {
    try {
        const destId = parseInt(req.params.id, 10);
        const destination = await destinationRepository.findAdminDestinationById(destId);

        if (!destination) {
            return res.status(404).json({ message: 'ไม่พบสถานที่' });
        }

        const imageRows = await destinationRepository.findAdminDestinationImageRows(destId);
        const jsonImages = normalizeStoredImages(destination.images);
        const tableImages = imageRows.map((image) => image.image_url).filter(Boolean);
        const combinedUrls = [...new Set([
            destination.image_url,
            ...jsonImages,
            ...tableImages,
        ].filter(Boolean))];
        destination.images = combinedUrls.map((imageUrl) => {
            const tableRow = imageRows.find((image) => image.image_url === imageUrl);
            return tableRow || {
                id: null,
                destination_id: destId,
                image_url: imageUrl,
                created_at: null,
            };
        });

        res.json(destination);
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการดึงข้อมูลสถานที่:', err);
        res.status(500).json({ message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" });
    }
};

/**
 * สร้างสถานที่ใหม่
 * POST /api/destinations
 */
// ตรวจข้อมูลและสร้างสถานที่ใหม่จากฟอร์ม admin
const createDestination = async (req, res) => {
    try {
        if (!req.body.name || !req.body.name.trim()) {
            return res.status(400).json({ message: 'กรุณากรอกชื่อสถานที่' });
        }

        const coordValidation = validateCoordinates(req.body.latitude, req.body.longitude);
        if (!coordValidation.isValid) {
            return res.status(400).json({ message: coordValidation.message });
        }

        const data = req.body;
        const location = normalizeLocationInput(data);
        const destId = await destinationRepository.createDestinationWithImages({
            name: data.name.trim(),
            address: nullableText(location.address),
            provinceId: nullableLocationId(location.provinceId),
            province: nullableText(location.province),
            districtId: nullableLocationId(location.districtId),
            district: nullableText(location.district),
            subDistrictId: nullableLocationId(location.subDistrictId),
            subDistrict: nullableText(location.subDistrict),
            postcode: nullableText(location.postcode),
            description: nullableText(data.description),
            category: normalizeAdminPlaceCategory(data.category),
            latitude: parseLatitude(data.latitude),
            longitude: parseLatitude(data.longitude),
            openingTime: data.opening_time || '00:00 AM',
            closingTime: data.closing_time || '00:00 PM',
            status: normalizePlaceStatus(data.status),
            imageUrl: data.image_url || null,
            admissionFeeJson: JSON.stringify(normalizeAdmissionFee(data.admission_fee)),
            galleryUrls: data.images,
        });

        const warning = await refreshDestinationEmbedding(destId, data.status);
        res.status(201).json({
            id: destId,
            message: warning || 'เพิ่มสถานที่สำเร็จ',
            ...(warning && { warning }),
        });
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการเพิ่มสถานที่:', err);
        res.status(400).json({ message: "ไม่สามารถเพิ่มสถานที่ได้" });
    }
};

/**
 * อัปเดตข้อมูลสถานที่
 * PUT /api/destinations/:id
 */
// อัปเดตสถานที่และลบไฟล์รูปที่ไม่ได้ใช้งานแล้ว
const updateDestination = async (req, res) => {
    try {
        const destId = parseInt(req.params.id, 10);
        const nextImages = normalizeImageUrls(req.body.images);

        const coordValidation = validateCoordinates(req.body.latitude, req.body.longitude);
        if (!coordValidation.isValid) {
            return res.status(400).json({ message: coordValidation.message });
        }

        const data = req.body;
        const location = normalizeLocationInput(data);
        const result = await destinationRepository.updateDestinationWithImages(destId, {
            name: data.name,
            address: nullableText(location.address),
            provinceId: nullableLocationId(location.provinceId),
            province: nullableText(location.province),
            districtId: nullableLocationId(location.districtId),
            district: nullableText(location.district),
            subDistrictId: nullableLocationId(location.subDistrictId),
            subDistrict: nullableText(location.subDistrict),
            postcode: nullableText(location.postcode),
            description: nullableText(data.description),
            category: normalizeAdminPlaceCategory(data.category),
            latitude: parseLatitude(data.latitude),
            longitude: parseLatitude(data.longitude),
            openingTime: data.opening_time,
            closingTime: data.closing_time,
            status: normalizePlaceStatus(data.status),
            imageUrl: data.image_url || null,
            admissionFee: normalizeAdmissionFee(data.admission_fee),
            galleryUrls: nextImages,
        });

        if (!result) {
            return res.status(404).json({ message: 'ไม่พบสถานที่ หรือไม่ใช่ข้อมูลของ Admin' });
        }

        const removedImagePaths = getRemovedImages(result.currentGalleryImages, nextImages);
        const previousMainImage = result.previousMainImage;

        if (previousMainImage && previousMainImage !== req.body.image_url && !nextImages.includes(previousMainImage)) {
            removedImagePaths.push(previousMainImage);
        }

        deleteUploadedFiles(removedImagePaths);

        const warning = await refreshDestinationEmbedding(destId, req.body.status);
        res.json({
            message: warning || 'อัปเดตสถานที่สำเร็จ',
            ...(warning && { warning }),
        });
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการอัปเดตสถานที่:', err);
        res.status(400).json({ message: "ไม่สามารถอัปเดตสถานที่ได้" });
    }
};

/**
 * ลบสถานที่
 * DELETE /api/destinations/:id
 */
// ลบสถานที่และไฟล์รูปที่เกี่ยวข้องเมื่อไม่มีรายการอ้างอิง
const deleteDestination = async (req, res) => {
    try {
        const destId = parseInt(req.params.id, 10);

        const imagePaths = await destinationRepository.removeDestination(destId);

        if (!imagePaths) {
            return res.status(404).json({ message: 'ไม่พบสถานที่' });
        }

        deleteUploadedFiles(imagePaths);
        await clearDestinationEmbedding(destId);
        res.json({ message: 'ลบสถานที่สำเร็จ' });
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการลบสถานที่:', err);
        res.status(500).json({ message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" });
    }
};

module.exports = {
    getAllDestinations,
    getDestinationById,
    createDestination,
    updateDestination,
    deleteDestination
};
