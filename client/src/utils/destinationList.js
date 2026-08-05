export const PAGE_SIZE = 10;
export const DEBOUNCE_MS = 500;

// ค่า id ต้องเป็น categoryCode ที่ TAT API รองรับ ไม่ใช่ label ภาษาไทย
export const PLACE_CATEGORIES = [
    { id: 'all', label: 'ทุกหมวดหมู่' },
    { id: 'attraction', label: 'สถานที่ท่องเที่ยว' },
    { id: 'accommodation', label: 'ที่พัก' },
    { id: 'restaurant', label: 'ร้านอาหาร' },
    { id: 'shop', label: 'ร้านค้า' },
    { id: 'other', label: 'อื่นๆ' }
];

export const EDITABLE_PLACE_CATEGORIES = PLACE_CATEGORIES.filter(({ id }) => id !== 'all');

const firstImage = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value[0] || '';
    return '';
};

const normalizeStatus = (status) => String(status || '').toLowerCase();

export const normalizeDestinationItems = ({ source, status, tatItems, adminItems }) => {
    let items = source === 'tat'
        ? tatItems.map((destination, index) => {
            const province = destination.location?.province?.name || '';
            return {
                id: destination.placeId || destination.id || `tat-${index}`,
                name: destination.name || 'ไม่ทราบชื่อ',
                province: province || 'ไม่ระบุจังหวัด',
                image: firstImage(destination.thumbnailUrl)
                    || destination.sha?.detailThumbnail
                    || destination.sha?.thumbnailUrl
                    || '',
                viewer: destination.viewer || 0,
                tags: destination.tags || [],
                status: normalizeStatus(destination.status),
                introduction: destination.introduction || destination.sha?.detail || '',
                category: destination.category?.name || '',
                source: 'tat_api'
            };
        })
        : adminItems.map((destination) => ({
            id: destination.id,
            name: destination.name,
            province: destination.province || '',
            image: destination.image_url || '',
            viewer: 0,
            tags: [],
            status: normalizeStatus(destination.status),
            source: destination.source === 'tat' ? 'tat_synced' : 'admin',
            category: PLACE_CATEGORIES.find(({ id }) => id === destination.category)?.label
                || destination.category
                || ''
        }));

    if (status !== 'all') items = items.filter((item) => item.status === status);
    return items;
};

export const getVisiblePageNumbers = (page, totalPages, maxVisible = 5) => {
    let start = Math.max(1, page - Math.floor(maxVisible / 2));
    const end = Math.min(totalPages, start + maxVisible - 1);
    if (end - start + 1 < maxVisible) start = Math.max(1, end - maxVisible + 1);
    return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
};
