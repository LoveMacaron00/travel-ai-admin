// Controller: Destination (สถานที่ท่องเที่ยว)
// จัดการ HTTP Request และ Response สำหรับสถานที่ท่องเที่ยว

const fs = require('fs');
const path = require('path');
const DestinationModel = require('../models/destinationModel');
const { embedDestination, clearDestinationEmbedding } = require('../services/embedService');

// ลบไฟล์จริงจาก /uploads (เฉพาะไฟล์ที่อยู่ใน /uploads เท่านั้น)
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

const normalizeImageUrls = (images) => {
    if (!Array.isArray(images)) return [];
    return [...new Set(images.filter((image) => typeof image === 'string' && image.trim()).map((image) => image.trim()))];
};

const getRemovedImages = (currentImages, nextImages) => {
    const nextSet = new Set(nextImages);
    return currentImages.filter((image) => image && !nextSet.has(image));
};

const validateCoordinates = (latitude, longitude) => {
    if (latitude !== undefined && latitude !== '' && latitude !== null) {
        const lat = parseFloat(latitude);
        if (isNaN(lat) || lat < -90 || lat > 90) {
            return { isValid: false, message: 'ค่าละติจูด (Latitude) ต้องอยู่ระหว่าง -90 ถึง 90' };
        }
    }
    if (longitude !== undefined && longitude !== '' && longitude !== null) {
        const lng = parseFloat(longitude);
        if (isNaN(lng) || lng < -180 || lng > 180) {
            return { isValid: false, message: 'ค่าลองจิจูด (Longitude) ต้องอยู่ระหว่าง -180 ถึง 180' };
        }
    }
    return { isValid: true };
};

/**
 * ดึงรายการสถานที่ทั้งหมด (รองรับตัวกรอง)
 * GET /api/destinations
 */
const getAllDestinations = async (req, res) => {
    try {
        const destinations = await DestinationModel.getAll(req.query);
        res.json(destinations);
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการดึงรายการสถานที่:', err);
        res.status(500).json({ message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" });
    }
};

/**
 * ดึงข้อมูลสถานที่ตาม ID พร้อมรูปภาพ
 * GET /api/destinations/:id
 */
const getDestinationById = async (req, res) => {
    try {
        const destId = parseInt(req.params.id, 10);
        const destination = await DestinationModel.getById(destId);

        if (!destination) {
            return res.status(404).json({ message: 'ไม่พบสถานที่' });
        }

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
const createDestination = async (req, res) => {
    try {
        if (!req.body.name || !req.body.name.trim()) {
            return res.status(400).json({ message: 'กรุณากรอกชื่อสถานที่' });
        }

        const coordValidation = validateCoordinates(req.body.latitude, req.body.longitude);
        if (!coordValidation.isValid) {
            return res.status(400).json({ message: coordValidation.message });
        }

        const destId = await DestinationModel.create(req.body, req.body.images);
        if ((req.body.status || 'approved') === 'approved') {
            await embedDestination(destId);
        } else {
            await clearDestinationEmbedding(destId);
        }
        res.status(201).json({ id: destId, message: 'เพิ่มสถานที่สำเร็จ' });
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการเพิ่มสถานที่:', err);
        res.status(400).json({ message: "ไม่สามารถเพิ่มสถานที่ได้" });
    }
};

/**
 * อัปเดตข้อมูลสถานที่
 * PUT /api/destinations/:id
 */
const updateDestination = async (req, res) => {
    try {
        const destId = parseInt(req.params.id, 10);
        const nextImages = normalizeImageUrls(req.body.images);

        const coordValidation = validateCoordinates(req.body.latitude, req.body.longitude);
        if (!coordValidation.isValid) {
            return res.status(400).json({ message: coordValidation.message });
        }

        const result = await DestinationModel.update(destId, req.body, nextImages);

        if (!result) {
            return res.status(404).json({ message: 'ไม่พบสถานที่ หรือไม่ใช่ข้อมูลของ Admin' });
        }

        const removedImagePaths = getRemovedImages(result.currentGalleryImages, nextImages);
        const previousMainImage = result.previousMainImage;

        if (previousMainImage && previousMainImage !== req.body.image_url && !nextImages.includes(previousMainImage)) {
            removedImagePaths.push(previousMainImage);
        }

        deleteUploadedFiles(removedImagePaths);

        if ((req.body.status || 'approved') === 'approved') {
            await embedDestination(destId);
        } else {
            await clearDestinationEmbedding(destId);
        }

        res.json({ message: 'อัปเดตสถานที่สำเร็จ' });
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการอัปเดตสถานที่:', err);
        res.status(400).json({ message: "ไม่สามารถอัปเดตสถานที่ได้" });
    }
};

/**
 * ลบสถานที่
 * DELETE /api/destinations/:id
 */
const deleteDestination = async (req, res) => {
    try {
        const destId = parseInt(req.params.id, 10);
        
        const imagePaths = await DestinationModel.delete(destId);

        if (!imagePaths) {
            return res.status(404).json({ message: 'ไม่พบสถานที่ หรือไม่ใช่ข้อมูลของ Admin' });
        }

        deleteUploadedFiles(imagePaths);
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
