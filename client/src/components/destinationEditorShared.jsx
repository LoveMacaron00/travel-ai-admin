import { useEffect } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

// Leaflet ไม่รู้ตำแหน่ง asset ของ marker เมื่อถูก bundle ด้วย Vite
// จึงกำหนด URL กลางครั้งเดียวและให้หน้าสร้าง/แก้ไขสถานที่ใช้ร่วมกัน
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Toolbar ต้องเหมือนกันทั้งหน้า Add และ Edit เพื่อไม่ให้ HTML ที่บันทึกมีรูปแบบต่างกัน
export const DESTINATION_EDITOR_MODULES = {
    toolbar: [
        [{ header: [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        ['link'],
        ['clean'],
    ],
};

/** เลื่อนแผนที่ตามค่าพิกัดที่เปลี่ยนจากฟอร์มหรือผลการค้นหา */
export const MapUpdater = ({ lat, lng }) => {
    const map = useMap();
    if (lat && lng) map.setView([lat, lng], map.getZoom());
    return null;
};

/** แจ้ง Leaflet ให้คำนวณขนาดใหม่หลัง panel ขยาย/ย่อเสร็จ */
export const MapResizeTrigger = ({ expanded }) => {
    const map = useMap();

    useEffect(() => {
        const timer = setTimeout(() => map.invalidateSize(), 300);
        return () => clearTimeout(timer);
    }, [map, expanded]);

    return null;
};

/** แปลง click บนแผนที่เป็น callback ที่ฟอร์ม Add/Edit เข้าใจร่วมกัน */
export const MapClickHandler = ({ onLocationSelect }) => {
    useMapEvents({
        click(event) {
            onLocationSelect(event.latlng.lat, event.latlng.lng);
        },
    });
    return null;
};
