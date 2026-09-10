// server/validators/destinationValidator.js
// ตรวจและ normalize ข้อมูลสถานที่จาก request — ย้ายออกจาก destinationController
// พฤติกรรมเดิมทุกประการ Controller เรียกใช้แล้วตอบ 400 เองเหมือนเดิม

const PLACE_STATUSES = ['pending', 'approved', 'rejected'];
const ADMIN_PLACE_CATEGORIES = ['attraction', 'accommodation', 'restaurant', 'shop', 'other'];

// แปลงสถานะสถานที่ให้เหลือค่าที่ระบบรองรับ
const normalizePlaceStatus = (status) => {
    const cleanStatus = String(status || 'approved').trim().toLowerCase();
    return PLACE_STATUSES.includes(cleanStatus) ? cleanStatus : 'approved';
};

// จำกัดหมวดหมู่ที่ AdminAdd บันทึกให้ตรงกับตัวกรองและแผนที่ในแอป
const normalizeAdminPlaceCategory = (category) => {
    const cleanCategory = String(category || 'attraction').trim().toLowerCase();
    return ADMIN_PLACE_CATEGORIES.includes(cleanCategory) ? cleanCategory : 'attraction';
};

// แปลง input URL รูปให้เป็นรายการข้อความที่ไม่ว่างและไม่ซ้ำ
const normalizeImageUrls = (images) => {
    if (!Array.isArray(images)) return [];
    return [...new Set(images.filter((image) => typeof image === 'string' && image.trim()).map((image) => image.trim()))];
};

// แปลงค่ารูปที่เก็บในฐานข้อมูลเป็น array ที่ใช้งานได้เสมอ
const normalizeStoredImages = (images) => {
    if (!Array.isArray(images)) return [];
    return images
        .map((image) => {
            if (typeof image === 'string') return image.trim();
            if (image && typeof image === 'object') {
                return String(image.image_url || image.url || '').trim();
            }
            return '';
        })
        .filter(Boolean);
};

// ทำให้ข้อมูลค่าเข้าชมอยู่ในรูปแบบ object ที่ปลอดภัยต่อการบันทึก
const normalizeAdmissionFee = (fee) => {
    if (!fee || typeof fee !== 'object' || Array.isArray(fee)) return {};
    const result = {};
    for (const key of ['thaiAdult', 'thaiChild', 'foreignerAdult', 'foreignerChild']) {
        const value = fee[key];
        if (value !== null && value !== undefined && String(value).trim() !== '') {
            result[key] = String(value).trim();
        }
    }
    if (fee.detail && String(fee.detail).trim()) result.detail = String(fee.detail).trim();
    return result;
};

// คืนข้อความที่ trim แล้ว หรือ null เมื่อไม่มีค่า
const nullableText = (value) => {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text || null;
};

// แปลงรหัสพื้นที่เป็นจำนวนเต็มไม่ติดลบ หรือ null
const nullableLocationId = (value) => {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

// จัดรูปแบบ field ที่อยู่จาก request ก่อนส่งเข้า query
const normalizeLocationInput = (data = {}) => {
    const location = data.location && typeof data.location === 'object' ? data.location : {};
    const province = location.province && typeof location.province === 'object' ? location.province : {};
    const district = location.district && typeof location.district === 'object' ? location.district : {};
    const subDistrict = location.subDistrict && typeof location.subDistrict === 'object'
        ? location.subDistrict
        : {};

    return {
        address: location.address ?? data.address,
        provinceId: province.provinceId ?? data.province_id,
        province: province.name ?? data.province,
        districtId: district.districtId ?? data.district_id,
        district: district.name ?? data.district,
        subDistrictId: subDistrict.subDistrictId ?? data.sub_district_id,
        subDistrict: subDistrict.name ?? data.sub_district,
        postcode: location.postcode ?? data.postcode,
    };
};

// หารูปเก่าที่ถูกนำออกจากรายการใหม่
const getRemovedImages = (currentImages, nextImages) => {
    const nextSet = new Set(nextImages);
    return currentImages.filter((image) => image && !nextSet.has(image));
};

// ตรวจละติจูดและลองจิจูดให้อยู่ในขอบเขตพิกัดโลก
const validateCoordinates = (latitude, longitude) => {
    if (latitude !== undefined && latitude !== '' && latitude !== null) {
        const lat = parseFloat(latitude);
        if (isNaN(lat) || lat < -90 || lat > 90) {
            return { isValid: false, message: 'ค่าละติจูด (Latitude) ต้องอยู่ระหว่าง -90 ถึง 90' };
        }
    }
    if (longitude !== undefined && longitude !== '' && longitude !== null) {
        const lng = parseFloat(longitude);
        if (isNaN(lng) || lng < -180 || lng > 180) {
            return { isValid: false, message: 'ค่าลองจิจูด (Longitude) ต้องอยู่ระหว่าง -180 ถึง 180' };
        }
    }
    return { isValid: true };
};

module.exports = {
    PLACE_STATUSES,
    ADMIN_PLACE_CATEGORIES,
    normalizePlaceStatus,
    normalizeAdminPlaceCategory,
    normalizeImageUrls,
    normalizeStoredImages,
    normalizeAdmissionFee,
    nullableText,
    nullableLocationId,
    normalizeLocationInput,
    getRemovedImages,
    validateCoordinates,
};
