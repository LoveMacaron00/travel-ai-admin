// server/controllers/tatController.js

const { config } = require('../config/env');
const { tatHeadersFor } = require('./helpers/tatLanguage');
const TAT_API_KEY = config.tat.apiKey;
const TAT_API_BASE = config.tat.apiBaseUrl;

// สร้าง header ตามภาษาใน request เพื่อเรียก TAT API
const requestTatHeaders = (req) =>
    tatHeadersFor(TAT_API_KEY, req.get('Accept-Language'));

// ตรวจสอบความถูกต้องของ API Key ใน Environment ก่อนเรียกใช้งาน
// ตรวจว่ามี TAT API key ก่อนส่ง request ไปยังผู้ให้บริการ
const checkEnvConfig = (res) => {
    if (!TAT_API_KEY || TAT_API_KEY === 'your_tat_api_key_here') {
        res.status(503).json({ message: "ไม่ได้ตั้งค่า TAT API Key ในระบบ (.env)" });
        return false;
    }
    return true;
};

 // ค้นหาสถานที่จาก TAT API
 // GET /api/v2/places
// ค้นหาสถานที่จาก TAT API แล้วส่งผลลัพธ์กลับให้ admin
const searchPlaces = async (req, res) => {
    if (!checkEnvConfig(res)) return;
    try {
        const { keyword, province, place_category, page = 1, limit = 10 } = req.query;

        // สร้าง query parameters สำหรับ TAT API
        const params = new URLSearchParams();
        params.set('numberOfResult', limit);
        params.set('page', page);
        if (keyword) params.set('keyword', keyword);
        if (province) params.set('provinceName', province);
        if (place_category) params.set('place_category', place_category);

        const url = `${TAT_API_BASE}/places?${params}`;
        const response = await fetch(url, { headers: requestTatHeaders(req) });
        const data = await response.json();

        res.vary('Accept-Language');
        res.status(response.status).json(data);
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการดึงข้อมูล TAT API (ค้นหา):', err);
        res.status(500).json({ message: "เกิดข้อผิดพลาดภายใน tatController - searchPlaces" });
    }
};

 // ดูรายละเอียดสถานที่จาก TAT API ตาม ID
 // GET /api/v2/places/:id
// ดึงรายละเอียดสถานที่หนึ่งแห่งจาก TAT API
const getPlaceById = async (req, res) => {
    if (!checkEnvConfig(res)) return;
    try {
        const url = `${TAT_API_BASE}/places/${req.params.id}`;
        const response = await fetch(url, { headers: requestTatHeaders(req) });
        const data = await response.json();

        res.vary('Accept-Language');
        res.status(response.status).json(data);
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการดึงข้อมูล TaT API (รายละเอียด):', err);
        res.status(500).json({ message: "เกิดข้อผิดพลาดภายใน tatController - getPlaceById" });
    }
};

module.exports = {
    searchPlaces,
    getPlaceById,
};
