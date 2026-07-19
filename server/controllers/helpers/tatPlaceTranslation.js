const firstValue = (...values) => {
    for (const value of values) {
        if (value !== null && value !== undefined && String(value).trim()) {
            return String(value).trim();
        }
    }
    return null;
};

const firstInteger = (...values) => {
    for (const value of values) {
        if (value === null || value === undefined || String(value).trim() === '') continue;
        const parsed = Number(value);
        if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
    }
    return null;
};

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
        admissionFee: place.information?.fee || place.fee || {},
        tatRaw: place,
    };
};

module.exports = { buildTATTranslation, getLocationParts };
