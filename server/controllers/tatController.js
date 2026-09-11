// server/controllers/tatController.js

const { config } = require('../config/env');
const { resolveTatLanguage, tatHeadersFor } = require('../utils/tatLanguage');
const { searchPlaceIndex } = require('../services/tatPlaceIndex');
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

// ค้นหาสถานที่จาก TAT API
// GET /api/v2/places
// - ปกติใช้ keyword ของ TAT
// - TAT คืนผลว่างเมื่อคำค้นเป็นคำไทยคำเดียวที่ใช้บ่อย (เช่น "วัด" "เกาะ" "หาด")
//   จึงค้นจากดัชนีสถานที่ของเราเองต่อ แล้วค่อยลองอีกภาษาเป็นทางเลือกสุดท้าย
const searchPlaces = async (req, res) => {
    if (!checkEnvConfig(res)) return;
    try {
        const { keyword, province, place_category, page = 1, limit = 10 } = req.query;
        const cleanKeyword = String(keyword || '').trim();
        const parsedPage = Math.max(1, Number.parseInt(page, 10) || 1);
        const parsedLimit = Math.max(1, Number.parseInt(limit, 10) || 10);

        const language = resolveTatLanguage(req.get('Accept-Language'));
        const otherLanguage = language === 'en' ? 'th' : 'en';

        const buildParams = () => {
            const params = new URLSearchParams();
            params.set('limit', parsedLimit);
            params.set('page', parsedPage);
            if (province) params.set('provinceName', province);
            if (place_category) params.set('place_category', place_category);
            return params;
        };

        const searchWithKeyword = async (lang) => {
            const params = buildParams();
            if (cleanKeyword) params.set('keyword', cleanKeyword);
            const response = await fetch(`${TAT_API_BASE}/places?${params}`, {
                headers: tatHeadersFor(TAT_API_KEY, lang),
            });
            const data = await response.json();
            return { status: response.status, data };
        };

        const searchIndex = (lang) => searchPlaceIndex({
            apiKey: TAT_API_KEY,
            apiBaseUrl: TAT_API_BASE,
            language: lang,
            province,
            placeCategory: place_category,
            keyword: cleanKeyword,
            page: parsedPage,
            limit: parsedLimit,
        });

        res.vary('Accept-Language');

        if (!cleanKeyword) {
            const { status, data } = await searchWithKeyword(language);
            return res.status(status).json(data);
        }

        const { status, data } = await searchWithKeyword(language);
        if (Array.isArray(data.data) && data.data.length > 0) {
            return res.status(status).json(data);
        }

        const indexResult = await searchIndex(language);
        if (indexResult.data.length > 0) return res.status(200).json(indexResult);

        const otherLanguageResult = await searchWithKeyword(otherLanguage);
        if (Array.isArray(otherLanguageResult.data.data) && otherLanguageResult.data.data.length > 0) {
            return res.status(otherLanguageResult.status).json(otherLanguageResult.data);
        }

        return res.status(200).json(indexResult);
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
