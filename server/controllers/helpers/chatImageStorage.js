const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const chatImagesDir = path.join(__dirname, '..', '..', 'uploads', 'chat-images');
const extensionByMimeType = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
};

const safeStoredFileName = (fileName) => {
    const value = String(fileName || '');
    return value && path.basename(value) === value ? value : null;
};

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

const deleteChatImage = async (fileName) => {
    const safeFileName = safeStoredFileName(fileName);
    if (!safeFileName) return;
    try {
        await fs.unlink(path.join(chatImagesDir, safeFileName));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
};

const absoluteChatImagePath = (fileName) => {
    const safeFileName = safeStoredFileName(fileName);
    return safeFileName ? path.join(chatImagesDir, safeFileName) : null;
};

module.exports = {
    absoluteChatImagePath,
    deleteChatImage,
    saveChatImage,
};
