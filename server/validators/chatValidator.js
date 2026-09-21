// server/validators/chatValidator.js
// ข้อความและกติกาตรวจ input ของ chat — ย้ายออกจาก chatController
// พฤติกรรมเดิมทุกประการ Controller เรียกใช้แล้วตอบ 400/404 เองเหมือนเดิม

const IMAGE_MESSAGES = {
    en: {
        missingImage: 'Please attach a photo.',
        sessionNotFound: 'Chat session not found.',
        imageNotFound: 'Chat image not found.',
        rateLimited: 'AI usage limit reached. Please wait a moment and try again.',
        analysisFailed: 'The image could not be analyzed right now.',
        userContent: {
            place: 'Scanned a place photo',
            sign: 'Scanned a Thai sign',
            food: 'Scanned a Thai food photo',
            default: 'Scanned a photo',
        },
    },
    th: {
        missingImage: 'กรุณาแนบรูปภาพ',
        sessionNotFound: 'ไม่พบ Chat session',
        imageNotFound: 'ไม่พบรูปภาพในประวัติแชท',
        rateLimited: 'ถึงขีดจำกัดการใช้งาน AI กรุณารอสักครู่แล้วลองใหม่',
        analysisFailed: 'ไม่สามารถวิเคราะห์รูปภาพได้ในขณะนี้',
        userContent: {
            place: 'สแกนรูปสถานที่',
            sign: 'สแกนป้ายภาษาไทย',
            food: 'สแกนรูปอาหารไทย',
            default: 'สแกนรูปภาพ',
        },
    },
};

const MESSAGE_MAX_LENGTH = 2000;

const MESSAGE_TEXT = {
    en: {
        required: 'Please enter a message.',
        tooLong: `The message must not exceed ${MESSAGE_MAX_LENGTH} characters.`,
        notFound: 'Message not found.',
        imageCannotEdit: 'Photo messages cannot be edited. Delete the photo and scan it again.',
        editFailed: 'The message could not be edited.',
        deleteFailed: 'The message could not be deleted.',
    },
    th: {
        required: 'กรุณาระบุข้อความ',
        tooLong: `ข้อความต้องไม่เกิน ${MESSAGE_MAX_LENGTH} ตัวอักษร`,
        notFound: 'ไม่พบข้อความ',
        imageCannotEdit: 'ไม่สามารถแก้ไขข้อความรูปภาพได้ กรุณาลบแล้วสแกนรูปใหม่',
        editFailed: 'ไม่สามารถแก้ไขข้อความได้',
        deleteFailed: 'ไม่สามารถลบข้อความได้',
    },
};

// ตรวจและ trim ข้อความ user ก่อนนำไปแก้ไขหรือส่งเข้า AI
// คืน { message } เมื่อผ่าน หรือ { error } เมื่อไม่ผ่าน
const validateEditableMessage = (value, languageCode = 'th') => {
    const text = MESSAGE_TEXT[languageCode] || MESSAGE_TEXT.th;
    const message = typeof value === 'string' ? value.trim() : '';
    if (!message) return { error: text.required };
    if (message.length > MESSAGE_MAX_LENGTH) return { error: text.tooLong };
    return { message };
};

module.exports = {
    IMAGE_MESSAGES,
    MESSAGE_MAX_LENGTH,
    MESSAGE_TEXT,
    validateEditableMessage,
};
