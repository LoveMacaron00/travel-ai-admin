// Controller: TAT (Tourism Authority of Thailand)
// จัดการ logic การเชื่อมต่อกับ TAT API ภายนอก

const { TAT_API_KEY, TAT_API_BASE } = require('../config/env');

// Headers สำหรับเรียก TAT API
const tatHeaders = {
    'x-api-key': TAT_API_KEY,
    'Accept-Language': 'th'
};

// ตรวจสอบความถูกต้องของ API Key ใน Environment ก่อนเรียกใช้งาน
const checkEnvConfig = (res) => {
    if (!TAT_API_KEY || TAT_API_KEY === 'your_tat_api_key_here') {
        res.status(503).json({ message: "ไม่ได้ตั้งค่า TAT API Key ในระบบ (.env)" });
        return false;
    }
    return true;
};

 // ค้นหาสถานที่จาก TAT API
 // GET /api/v2/places
const searchPlaces = async (req, res) => {
    if (!checkEnvConfig(res)) return;
    try {
        const { keyword, province, page = 1, limit = 10 } = req.query;

        // สร้าง query parameters สำหรับ TAT API
        const params = new URLSearchParams();
        params.set('numberOfResult', limit);
        params.set('page', page);
        if (keyword) params.set('keyword', keyword);
        if (province) params.set('provinceName', province);

        const url = `${TAT_API_BASE}/places?${params}`;
        const response = await fetch(url, { headers: tatHeaders });
        const data = await response.json();

        res.json(data);
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการดึงข้อมูล TAT API (ค้นหา):', err);
        res.status(500).json({ message: "เกิดข้อผิดพลาดภายใน tatController - searchPlaces" });
    }
};

 // ดูรายละเอียดสถานที่จาก TAT API ตาม ID
 // GET /api/v2/places/:id
const getPlaceById = async (req, res) => {
    if (!checkEnvConfig(res)) return;
    try {
        const url = `${TAT_API_BASE}/places/${req.params.id}`;
        const response = await fetch(url, { headers: tatHeaders });
        const data = await response.json();

        res.json(data);
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการดึงข้อมูล TaT API (รายละเอียด):', err);
        res.status(500).json({ message: "เกิดข้อผิดพลาดภายใน tatController - getPlaceById" });
    }
};

// ดึงข้อมูล events จาก TAT API
// GET /api/v2/events
const getEvents = async (req, res) => {
    if (!checkEnvConfig(res)) return;
    try {
        const url = `${TAT_API_BASE}/events`;
        const response = await fetch(url, { headers: tatHeaders });
        const data = await response.json();
        res.json(data);
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการดึงข้อมูล TAT API (Events):', err);
        res.status(500).json({ message: "เกิดข้อผิดพลาดภายใน tatController - getEvents" });
    }
}

// ดูรายละเอียด event จาก TAT API ตาม ID
// GET /api/v2/events/:id
const getEventById = async (req, res) => {
    if (!checkEnvConfig(res)) return;
    try {
        const url = `${TAT_API_BASE}/events/${req.params.id}`;
        const response = await fetch(url, { headers: tatHeaders });
        const data = await response.json();
        res.json(data);
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการดึงข้อมูล TAT API (รายละเอียด Event):', err);
        res.status(500).json({ message: "เกิดข้อผิดพลาดภายใน tatController - getEventById" });       
    }
}


module.exports = {
    searchPlaces,
    getPlaceById,
    getEvents,
    getEventById
};
