// server/services/diaryImageCleanup.js
// ลบไฟล์รูป diary ที่ไม่มี entry ไหนอ้างอิงแล้วออกจาก /uploads
//
// กฎความปลอดภัย (กันลบไฟล์มั่ว):
// - ลบเฉพาะ URL ที่เป็นไฟล์ชั้น root ของ /uploads เท่านั้น
//   (/uploads/tat/, /uploads/preferences/, /uploads/chat-images/ เป็น asset
//   ส่วนกลาง ห้ามแตะ — กันด้วยกติกาว่าหลัง /uploads/ ต้องไม่มี '/' อีก)
// - นามสกุลต้องเป็นรูปภาพที่ multer รับ (jpg/jpeg/png/gif/webp)
// - ลบจริงก็ต่อเมื่อไม่มี diary entry ของผู้ใช้คนไหนอ้างอิง URL นี้แล้ว
//   และไม่ใช่รูปหลัก/แกลเลอรีของ destinations
const fs = require('fs');
const path = require('path');
const { uploadsDir } = require('../config/storage');

const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

// ดึง path (/uploads/xxx) ออกจาก URL ที่ client ส่งมา (รับทั้ง relative และ absolute)
const extractUploadPath = (value) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim().slice(0, 500);
    if (!trimmed) return null;
    let pathname = trimmed;
    if (/^https?:\/\//i.test(trimmed)) {
        try {
            pathname = new URL(trimmed).pathname;
        } catch {
            return null;
        }
    }
    return pathname;
};

// true = ไฟล์นี้อยู่ในขอบเขตที่ลบได้ (root ของ /uploads + นามสกุลรูป)
const isDeletableUploadPath = (uploadPath) => {
    if (typeof uploadPath !== 'string') return false;
    if (!uploadPath.startsWith('/uploads/')) return false;
    const rest = uploadPath.slice('/uploads/'.length);
    if (!rest || rest.includes('/')) return false;
    if (rest === '.' || rest === '..') return false;
    return ALLOWED_EXTS.has(path.extname(rest).toLowerCase());
};

// ลบไฟล์ที่ไม่มีใครอ้างอิงแล้ว คืน { deleted: [url], skipped: [url] }
// ไฟล์หายไปก่อนแล้ว (ENOENT) ถือว่าสำเร็จ — นับเข้า deleted
const removeUnreferencedUploads = async (db, urls, isReferenced) => {
    const deleted = [];
    const skipped = [];
    const unique = [...new Set((urls || []).filter(Boolean))];
    for (const raw of unique) {
        const uploadPath = extractUploadPath(raw);
        if (!isDeletableUploadPath(uploadPath)) {
            skipped.push(raw);
            continue;
        }
        try {
            if (await isReferenced(uploadPath)) {
                skipped.push(raw);
                continue;
            }
        } catch (error) {
            console.error('[diaryImageCleanup] ref-check:', uploadPath, error.message);
            skipped.push(raw);
            continue;
        }
        const fullPath = path.join(uploadsDir, path.basename(uploadPath));
        try {
            await fs.promises.unlink(fullPath);
            deleted.push(raw);
        } catch (error) {
            if (error.code === 'ENOENT') {
                deleted.push(raw);
            } else {
                console.error('[diaryImageCleanup] unlink:', fullPath, error.message);
                skipped.push(raw);
            }
        }
    }
    return { deleted, skipped };
};

module.exports = {
    extractUploadPath,
    isDeletableUploadPath,
    removeUnreferencedUploads,
};
