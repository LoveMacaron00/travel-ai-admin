// server/config/storage.js
// Centralized storage paths — previously duplicated in 3 places:
// - config/multer.js: path.join(__dirname, '..', 'uploads')
// - services/chatImageStorage.js: path.join(__dirname, '..', 'uploads', 'chat-images')
// - routes/preferenceRoutes.js: path.join(__dirname, '..', 'uploads', 'preferences')
// Now single source of truth; behavior identical (same resolved paths).
const path = require('path');
const fs = require('fs');

const uploadsDir = path.join(__dirname, '..', 'uploads');
const chatImagesDir = path.join(uploadsDir, 'chat-images');
const preferencesDir = path.join(uploadsDir, 'preferences');

// Ensure base dirs exist synchronously (same as multer.js did)
for (const dir of [uploadsDir, chatImagesDir, preferencesDir]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

module.exports = {
  uploadsDir,
  chatImagesDir,
  preferencesDir,
};
