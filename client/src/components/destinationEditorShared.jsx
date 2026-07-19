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

L.Control.Zoom.prototype.options.zoomInTitle = 'ซูมเข้า';
L.Control.Zoom.prototype.options.zoomOutTitle = 'ซูมออก';

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

const EDITOR_BUTTON_LABELS = {
    'ql-bold': 'ตัวหนา',
    'ql-italic': 'ตัวเอียง',
    'ql-underline': 'ขีดเส้นใต้',
    'ql-strike': 'ขีดทับ',
    'ql-link': 'แทรกลิงก์',
    'ql-clean': 'ล้างรูปแบบ',
};

/** เปลี่ยนชื่อเครื่องมือที่ Quill สร้างเป็นภาษาไทยหลัง editor แสดงผล */
export const useThaiDestinationEditorLabels = () => {
    useEffect(() => {
        const timer = setTimeout(() => {
            document.querySelectorAll('.ql-toolbar button').forEach((button) => {
                const className = Object.keys(EDITOR_BUTTON_LABELS)
                    .find((name) => button.classList.contains(name));
                const listType = button.classList.contains('ql-list')
                    ? button.value || button.getAttribute('value')
                    : null;
                const label = className
                    ? EDITOR_BUTTON_LABELS[className]
                    : listType === 'ordered'
                        ? 'รายการลำดับเลข'
                        : listType === 'bullet'
                            ? 'รายการหัวข้อ'
                            : '';

                if (label) {
                    button.setAttribute('aria-label', label);
                    button.setAttribute('title', label);
                }
            });

            document.querySelectorAll('.ql-header .ql-picker-label').forEach((label) => {
                label.setAttribute('aria-label', 'รูปแบบข้อความ');
                label.setAttribute('title', 'รูปแบบข้อความ');
            });

            document.querySelectorAll('.ql-header .ql-picker-item').forEach((item) => {
                const value = item.getAttribute('data-value');
                const label = value ? `หัวข้อ ${value}` : 'ข้อความปกติ';
                item.setAttribute('aria-label', label);
                item.setAttribute('title', label);
            });

            document.querySelectorAll('.ql-tooltip input').forEach((input) => {
                input.setAttribute('placeholder', 'กรอก URL');
                input.setAttribute('aria-label', 'URL ของลิงก์');
            });
            document.querySelectorAll('.ql-tooltip .ql-action').forEach((action) => {
                action.setAttribute('aria-label', 'บันทึกหรือแก้ไขลิงก์');
            });
            document.querySelectorAll('.ql-tooltip .ql-remove').forEach((remove) => {
                remove.setAttribute('aria-label', 'ลบลิงก์');
            });
        }, 0);

        return () => clearTimeout(timer);
    }, []);
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
