// server/controllers/tatController.js

const { config } = require('../config/env');
const { resolveTatLanguage, tatHeadersFor } = require('./helpers/tatLanguage');
const TAT_API_KEY = config.tat.apiKey;
const TAT_API_BASE = config.tat.apiBaseUrl;

// สร้าง header ตามภาษาใน request เพื่อเรียก TAT API
const requestTatHeaders = (req) =>
    tatHeadersFor(TAT_API_KEY, req.get('Accept-Language'));

// ตรวจสอบความถูกต้องของ API Key ใน Environment ก่อนเรียกใช้งาน
const checkEnvConfig = (res) => {
    if (!TAT_API_KEY || TAT_API_KEY === 'your_tat_api_key_here') {
        res.status(503).json({ message: "ไม่ได้ตั้งค่า TAT API Key ในระบบ (.env)" });
        return false;
    }
    return true;
};

// ตรวจว่าชื่อสถานที่มีคำค้นอยู่ (contains) โดยไม่สนใจตัวพิมพ์เล็ก/ใหญ่
// ใช้กรองผลลัพธ์จาก TAT API ที่อาจคืนสถานที่ไม่เกี่ยวข้องกับชื่อที่ค้น
const nameMatchesKeyword = (place, keyword) => {
    const lower = String(keyword).toLowerCase();
    return [place.name, place.placeName, place.title, place.nameTh, place.nameEn]
        .some((name) => name && String(name).toLowerCase().includes(lower));
};

// กรองเฉพาะผลที่มีคำค้นอยู่ในชื่อ
const filterByName = (items, keyword) => items.filter((place) => nameMatchesKeyword(place, keyword));

// ค้นหาสถานที่จาก TAT API
// GET /api/v2/places
// - ค้นตาม TAT keyword แล้วกรองชื่อ (TAT อาจคืนผลที่ไม่เกี่ยวกับชื่อที่พิม)
// - ไม่เจอ → ลองอีกภาษา แล้วกรองชื่ออีกครั้ง
// - ยังไม่เจอ → คืน empty result
const searchPlaces = async (req, res) => {
    if (!checkEnvConfig(res)) return;
    try {
        const { keyword, province, place_category, page = 1, limit = 10 } = req.query;
        const cleanKeyword = String(keyword || '').trim();
        const parsedPage = Math.max(1, Number.parseInt(page, 10) || 1);
        const parsedLimit = Math.max(1, Number.parseInt(limit, 10) || 10);

        const language = resolveTatLanguage(req.get('Accept-Language'));
        const otherLanguage = language === 'en' ? 'th' : 'en';

        // พารามิเตอร์ร่วม (ไม่รวม keyword และหน้า)
        const baseParams = new URLSearchParams();
        if (province) baseParams.set('provinceName', province);
        if (place_category) baseParams.set('place_category', place_category);

        // เรียก TAT API หนึ่งครั้งตาม keyword และภาษา
        const searchWithKeyword = async (kw, lang) => {
            const params = new URLSearchParams(baseParams);
            params.set('numberOfResult', parsedLimit);
            params.set('page', parsedPage);
            if (kw) params.set('keyword', kw);
            const response = await fetch(`${TAT_API_BASE}/places?${params}`, {
                headers: tatHeadersFor(TAT_API_KEY, lang),
            });
            const data = await response.json();
            return { status: response.status, data };
        };

        res.vary('Accept-Language');

        if (cleanKeyword) {
            // 1) ค้นด้วย TAT keyword ตามภาษาที่ขอ แล้วกรองเฉพาะที่มีชื่อตรง
            let { status, data } = await searchWithKeyword(cleanKeyword, language);
            let filtered = filterByName(Array.isArray(data.data) ? data.data : [], cleanKeyword);

            // 2) ถ้ากรองแล้วได้ 0 ลองอีกภาษาหนึ่ง แล้วกรองอีกครั้ง
            if (filtered.length === 0) {
                const alt = await searchWithKeyword(cleanKeyword, otherLanguage);
                const altFiltered = filterByName(Array.isArray(alt.data.data) ? alt.data.data : [], cleanKeyword);
                if (altFiltered.length > 0) {
                    status = alt.status;
                    data = alt.data;
                    filtered = altFiltered;
                }
            }

            // 3) มีผลที่ตรงชื่อ → คืน filtered items พร้อม pagination ที่ปรับแล้ว
            if (filtered.length > 0) {
                return res.status(status).json({
                    ...data,
                    data: filtered,
                    pagination: {
                        ...(data.pagination || {}),
                        total: filtered.length,
                        pageSize: filtered.length,
                    },
                });
            }

            // 4) ไม่มีชื่อสถานที่ตรงกับคำค้นเลย → คืน empty result
            return res.status(200).json({
                data: [],
                pagination: { pageNumber: parsedPage, pageSize: parsedLimit, total: 0 },
            });
        }

        // ไม่มี keyword → ส่งต่อไปยัง TAT ตามเดิม
        const params = new URLSearchParams(baseParams);
        params.set('numberOfResult', parsedLimit);
        params.set('page', parsedPage);
        const response = await fetch(`${TAT_API_BASE}/places?${params}`, {
            headers: requestTatHeaders(req),
        });
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการดึงข้อมูล TAT API (ค้นหา):', err);
        res.status(500).json({ message: "เกิดข้อผิดพลาดภายใน tatController - searchPlaces" });
    }
};

// ดึงรายละเอียดสถานที่หนึ่งแห่งจาก TAT API
// GET /api/v2/places/:id
const getPlaceById = async (req, res) => {
    if (!checkEnvConfig(res)) return;
    try {
        const url = `${TAT_API_BASE}/places/${req.params.id}`;
        const response = await fetch(url, { headers: requestTatHeaders(req) });
        const data = await response.json();

        res.vary('Accept-Language');
        res.status(response.status).json(data);
    } catch (err) {
        console.error('เกิดข้อผิดพลาดในการดึงข้อมูล TAT API (รายละเอียด):', err);
        res.status(500).json({ message: "เกิดข้อผิดพลาดภายใน tatController - getPlaceById" });
    }
};

module.exports = {
    searchPlaces,
    getPlaceById,
};

