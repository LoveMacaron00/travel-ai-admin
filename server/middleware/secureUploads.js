// server/middleware/secureUploads.js — now reuses unified auth.js verify logic (behavior identical)
const { extractBearer, verifyUploadToken } = require('./auth');

// อนุญาตให้เข้าถึงไฟล์ upload เฉพาะ admin หรือผู้ใช้ที่ยังไม่ถูกระงับ
const secureUploads = async (req, res, next) => {
    // รูป AI Camera ต้องผ่าน endpoint ที่ตรวจว่า message เป็นของ user เท่านั้น
    // ห้าม express.static เปิดไฟล์จากโฟลเดอร์นี้แม้ request จะมี token ถูกต้อง
    if (req.path === '/chat-images' || req.path.startsWith('/chat-images/')) {
        return res.status(404).json({ message: 'ไม่พบไฟล์' });
    }

    // รูป preference icons เปิดให้เข้าถึงได้แบบสาธารณะสำหรับแอปมือถือและหน้าเว็บ
    if (req.path === '/preferences' || req.path.startsWith('/preferences/')) {
        return next();
    }

    const token = extractBearer(req);
    if (!token) {
        return res.status(401).json({ message: 'จำเป็นต้องเข้าสู่ระบบเพื่อเข้าถึงไฟล์นี้' });
    }

    try {
        const verified = await verifyUploadToken(token);
        if (verified == null) {
            return res.status(401).json({ message: 'Token ไม่ถูกต้อง' });
        }
        if (verified.type === 'admin') return next();
        if (verified.type === 'banned') {
            return res.status(403).json({ message: 'บัญชีนี้ถูกระงับการใช้งาน' });
        }
        if (verified.type === 'user') return next();
        if (verified.type === 'invalid') {
            return res.status(401).json({ message: 'ไม่พบข้อมูลผู้ใช้ในระบบ' });
        }
        return res.status(401).json({ message: 'Token ไม่ถูกต้อง' });
    } catch (err) {
        return res.status(401).json({ message: 'การยืนยันตัวตนล้มเหลวหรือ Token หมดอายุ' });
    }
};

module.exports = { secureUploads };
