// คืนข้อความที่ไม่ว่างค่าแรกจาก field หลายรูปแบบของข้อมูล TAT
const firstValue = (...values) => {
    for (const value of values) {
        if (value !== null && value !== undefined && String(value).trim()) {
            return String(value).trim();
        }
    }
    return null;
};

// คืนจำนวนเต็มไม่ติดลบค่าแรกจาก field หลายรูปแบบของข้อมูล TAT
const firstInteger = (...values) => {
    for (const value of values) {
        if (value === null || value === undefined || String(value).trim() === '') continue;
        const parsed = Number(value);
        if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
    }
    return null;
};

// แยกข้อมูลที่อยู่จาก payload TAT ให้เป็นโครงสร้างเดียวกัน
const getLocationParts = (place = {}) => {
    const provinceId = firstInteger(
        place.location?.province?.provinceId,
        place.location?.province?.id,
        place.provinceId,
        place.province_id,
    );
    const province = firstValue(
        place.location?.province?.name,
        place.province_name,
        place.provinceName,
        place.province,
    );
    const districtId = firstInteger(
        place.location?.district?.districtId,
        place.location?.district?.id,
        place.districtId,
        place.district_id,
    );
    const district = firstValue(
        place.location?.district?.name,
        place.district_name,
        place.districtName,
        place.district,
    );
    const subDistrictId = firstInteger(
        place.location?.subDistrict?.subDistrictId,
        place.location?.subDistrict?.id,
        place.subDistrictId,
        place.sub_district_id,
    );
    const subDistrict = firstValue(
        place.location?.subDistrict?.name,
        place.sub_district,
        place.subDistrictName,
        place.subDistrict,
    );
    const postcode = firstValue(
        place.location?.postcode,
        place.postcode,
        place.postalCode,
    );
    const streetAddress = firstValue(place.location?.address, place.address);

    return {
        address: streetAddress,
        provinceId,
        province,
        districtId,
        district,
        subDistrictId,
        subDistrict,
        postcode,
    };
};

// ล้างราคารูป "5885.00000" / "0.00000" / null ให้เป็น string จำนวนเต็มที่สะอาด หรือ null
const cleanPriceValue = (value) => {
    if (value === null || value === undefined) return null;
    const text = String(value).trim().replace(/,/g, '');
    if (!text) return null;
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Number.isInteger(parsed) ? String(parsed) : String(parsed);
};

// รวมค่าเข้าชม + ราคาที่พักต่อหมวดหมู่จาก payload TAT
// - attraction/restaurant/shop: ใช้ information.fee ตามเดิม
// - hotel (ที่พัก): TAT ไม่มี information.fee แต่มี minPrice/maxPrice ที่ root
//   จึงพับเป็น roomMinPrice/roomMaxPrice + ข้อมูลโรงแรม (ดาว/เช็คอิน-เอาต์/จำนวนห้อง)
//   เก็บลง admission_fee ช่องเดียวกับค่าเข้าชม เพื่อไม่ต้องเพิ่มคอลัมน์ และให้
//   stay logic (parseAdmissionPrice) กับ mobile (resolveAdmissionFee) อ่านเจอทันที
const buildAdmissionFeeObject = (place = {}) => {
    const base = place.information?.fee || place.fee;
    const result = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
    const min = cleanPriceValue(place.minPrice ?? place.min_price);
    const max = cleanPriceValue(place.maxPrice ?? place.max_price);
    if (min) result.roomMinPrice = min;
    if (max) result.roomMaxPrice = max;
    const info = place.information;
    if (info && typeof info === 'object') {
        if (info.hotelStar !== null && info.hotelStar !== undefined && String(info.hotelStar).trim() !== '') {
            result.hotelStar = String(info.hotelStar).trim();
        }
        if (info.checkInTime) result.checkInTime = String(info.checkInTime).trim();
        if (info.checkOutTime) result.checkOutTime = String(info.checkOutTime).trim();
        if (info.numberOfRooms !== null && info.numberOfRooms !== undefined && String(info.numberOfRooms).trim() !== '') {
            result.numberOfRooms = String(info.numberOfRooms).trim();
        }
    }
    return result;
};

// แปลง payload TAT เป็นข้อมูลข้อความสำหรับบันทึกใน destination_translations
const buildTATTranslation = (place = {}) => {
    const name = firstValue(place.name, place.placeName, place.title);
    if (!name) return null;

    const { address, province, district, subDistrict, postcode } = getLocationParts(place);
    return {
        name,
        province,
        district,
        subDistrict,
        postcode,
        description: firstValue(place.information?.detail, place.detail, place.description),
        address,
        tags: Array.isArray(place.tags) ? place.tags.filter(Boolean).map(String) : [],
        openingHours: Array.isArray(place.openingHours) ? place.openingHours : [],
        admissionFee: buildAdmissionFeeObject(place),
        tatRaw: place,
    };
};

module.exports = { buildTATTranslation, buildAdmissionFeeObject, cleanPriceValue, getLocationParts };
