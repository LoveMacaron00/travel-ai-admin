const firstValue = (...values) => {
    for (const value of values) {
        if (value !== null && value !== undefined && String(value).trim()) {
            return String(value).trim();
        }
    }
    return null;
};

const getLocationParts = (place = {}) => {
    const province = firstValue(
        place.location?.province?.name,
        place.province_name,
        place.provinceName,
        place.province,
    );
    const district = firstValue(
        place.location?.district?.name,
        place.district_name,
        place.districtName,
        place.district,
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
    const locationParts = [subDistrict, district, province].filter(Boolean);
    const addressParts = [streetAddress, ...locationParts, postcode].filter(Boolean);

    return {
        province,
        location: locationParts.join(', ') || null,
        address: [...new Set(addressParts)].join(', ') || null,
    };
};

const buildTATTranslation = (place = {}) => {
    const name = firstValue(place.name, place.placeName, place.title);
    if (!name) return null;

    const { province, location, address } = getLocationParts(place);
    return {
        name,
        province: location || province,
        description: firstValue(place.information?.detail, place.detail, place.description),
        address,
        tags: Array.isArray(place.tags) ? place.tags.filter(Boolean).map(String) : [],
        openingHours: Array.isArray(place.openingHours) ? place.openingHours : [],
        admissionFee: place.information?.fee || place.fee || {},
        tatRaw: place,
    };
};

module.exports = { buildTATTranslation, getLocationParts };
