const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { chatImagesDir } = require('../../config/storage');
const extensionByMimeType = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
};

// ยอมรับเฉพาะชื่อไฟล์เดี่ยวเพื่อป้องกัน path traversal
const safeStoredFileName = (fileName) => {
    const value = String(fileName || '');
    return value && path.basename(value) === value ? value : null;
};

// บันทึกภาพแชทด้วยชื่อสุ่มและคืนชื่อไฟล์สำหรับเก็บในฐานข้อมูล
const saveChatImage = async (imageBuffer, mimeType) => {
    const extension = extensionByMimeType[mimeType];
    if (!Buffer.isBuffer(imageBuffer) || !extension) {
        throw new Error('Unsupported chat image');
    }

    await fs.mkdir(chatImagesDir, { recursive: true });
    const fileName = `${crypto.randomUUID()}${extension}`;
    await fs.writeFile(path.join(chatImagesDir, fileName), imageBuffer, { flag: 'wx' });
    return fileName;
};

// ลบภาพแชทที่ระบุ โดยไม่ถือว่าไฟล์ที่หายไปเป็นข้อผิดพลาด
const deleteChatImage = async (fileName) => {
    const safeFileName = safeStoredFileName(fileName);
    if (!safeFileName) return;
    try {
        await fs.unlink(path.join(chatImagesDir, safeFileName));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
};

// คืน path เต็มของภาพแชทเมื่อชื่อไฟล์ปลอดภัย
const absoluteChatImagePath = (fileName) => {
    const safeFileName = safeStoredFileName(fileName);
    return safeFileName ? path.join(chatImagesDir, safeFileName) : null;
};

module.exports = {
    absoluteChatImagePath,
    deleteChatImage,
    saveChatImage,
};
