// Controller: TAT (Tourism Authority of Thailand)
// จัดการ logic การเชื่อมต่อกับ TAT API ภายนอก

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const TAT_API_BASE = 'https://tatdataapi.io/api/v2';
const TAT_API_KEY = process.env.TATDATAAPI;

// Headers สำหรับเรียก TAT API
const tatHeaders = {
    'x-api-key': TAT_API_KEY,
    'Accept-Language': 'th'
};

/**
 * ฟังก์ชัน fetch พร้อม timeout
 * @param {string} url - URL ที่ต้องการเรียก
 * @param {object} options - ตัวเลือกสำหรับ fetch
 * @param {number} timeoutMs - เวลา timeout (มิลลิวินาที)
 * @returns {Response} - ผลลัพธ์จาก fetch
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        return response;
    } finally {
        clearTimeout(timer);
    }
}

 // ค้นหาสถานที่จาก TAT API
 // GET /api/v2/places
const searchPlaces = async (req, res) => {
    try {
        const { keyword, province, page = 1, limit = 10 } = req.query;

        // สร้าง query parameters สำหรับ TAT API
        const params = new URLSearchParams();
        params.set('numberOfResult', limit);
        params.set('page', page);
        if (keyword) params.set('keyword', keyword);
        if (province) params.set('provinceName', province);

        const url = `${TAT_API_BASE}/places?${params}`;
        const response = await fetchWithTimeout(url, { headers: tatHeaders });
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
    try {
        const url = `${TAT_API_BASE}/places/${req.params.id}`;
        const response = await fetchWithTimeout(url, { headers: tatHeaders });
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
    try {

    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการดึงข้อมูล TAT API (Events):', err);
        res.status(500).json({ message: "เกิดข้อผิดพลาดภายใน tatController - getEvents" });
    }
}


module.exports = {
    searchPlaces,
    getPlaceById
};
