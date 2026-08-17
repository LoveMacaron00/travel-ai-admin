// server/controllers/tatController.js

const { config } = require('../config/env');
const { resolveTatLanguage, tatHeadersFor } = require('./helpers/tatLanguage');
const TAT_API_KEY = config.tat.apiKey;
const TAT_API_BASE = config.tat.apiBaseUrl;

// TAT API กำหนด pageSize คงที่ 10 (พารามิเตอร์ numberOfResult ถูก ignore)
// จำนวนหน้าสูงสุดที่ดึงมาใช้ค้นหาท้องถิ่นเมื่อ TAT keyword ค้นไม่เจอ (10 หน้า = 100 รายการ)
const FALLBACK_MAX_PAGES = 10;

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

// ตรวจว่าชื่อสถานที่ตรงกับคำค้นแบบ contains (ไม่ต้องตรงตัว)
const nameMatchesKeyword = (place, keyword) => {
    const lower = String(keyword).toLowerCase();
    return [place.name, place.placeName, place.title]
        .some((name) => name && String(name).toLowerCase().includes(lower));
};

// ค้นหาท้องถิ่น: ดึงหลายหน้าจาก TAT แบบไม่ใช้ keyword แล้วกรองชื่อเอง
// ใช้เมื่อ TAT keyword ค้นไม่เจอ เช่น คำสั้น 1 ตัวอักษร หรือคำที่ TAT จับคู่ไม่ตรง
const searchTatLocally = async (keyword, baseParams, page, limit) => {
    // คำภาษาไทยใช้ข้อมูลไทย ส่วนคำภาษาอื่นใช้ข้อมูลอังกฤษ
    const hasThai = /[\u0E00-\u0E7F]/.test(keyword);
    const headers = tatHeadersFor(TAT_API_KEY, hasThai ? 'th' : 'en');

    const requests = [];
    for (let p = 1; p <= FALLBACK_MAX_PAGES; p++) {
        const params = new URLSearchParams(baseParams);
        params.set('page', p);
        requests.push(fetch(`${TAT_API_BASE}/places?${params}`, { headers }));
    }

    const responses = await Promise.all(requests);
    const all = [];
    for (const response of responses) {
        if (!response.ok) continue;
        const data = await response.json();
        all.push(...(Array.isArray(data.data) ? data.data : []));
    }

    // กรองเฉพาะชื่อที่มีคำค้น (กันรายการซ้ำด้วย placeId)
    const seen = new Set();
    const matches = all.filter((place) => {
        const id = place.placeId ?? place.id;
        if (id !== undefined && id !== null) {
            if (seen.has(id)) return false;
            seen.add(id);
        }
        return nameMatchesKeyword(place, keyword);
    });

    const start = (page - 1) * limit;
    return {
        data: matches.slice(start, start + limit),
        pagination: {
            pageNumber: page,
            pageSize: limit,
            total: matches.length,
        },
    };
};

 // ค้นหาสถานที่จาก TAT API
 // GET /api/v2/places
// ค้นหาสถานที่จาก TAT API แล้วส่งผลลัพธ์กลับให้ admin
// - ค้นตาม TAT keyword ก่อน (ภาษาเดียวกับที่ request มา)
// - ไม่เจอ → ลองอีกภาษา (เช่นพิมพ์อังกฤษ แต่ admin ส่ง header เป็นไทย)
// - ยังไม่เจอ (เช่น keyword 1 ตัวอักษร) → ดึงหลายหน้าแล้วกรองชื่อแบบ contains
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
            // 1) ค้นด้วย TAT keyword ตามภาษาที่ขอ
            let { status, data } = await searchWithKeyword(cleanKeyword, language);

            // 2) ถ้าไม่เจอ ลองอีกภาษาหนึ่ง (เช่นพิมพ์อังกฤษ แต่ header เป็นไทย)
            if ((data.pagination?.total || 0) === 0) {
                const alt = await searchWithKeyword(cleanKeyword, otherLanguage);
                if ((alt.data.pagination?.total || 0) > 0) {
                    status = alt.status;
                    data = alt.data;
                }
            }

            // 3) ยังไม่เจอ → ดึงหลายหน้าแล้วกรองชื่อแบบ contains
            if ((data.pagination?.total || 0) === 0) {
                const fallback = await searchTatLocally(cleanKeyword, baseParams, parsedPage, parsedLimit);
                return res.status(200).json(fallback);
            }

            return res.status(status).json(data);
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
