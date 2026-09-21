// server/utils/ttlCache.js
// TTL cache ใน memory ที่ใช้ร่วมกัน — ย้าย getCache/setCache คู่ซ้ำใน services มารวมที่นี่
// (logic เดิมทุกประการ: หมดอายุแล้วลบ, เต็มแล้วลบ key เก่าสุดออกก่อน)

// getTtlMs รับเป็น function เพื่อให้อ่านค่า config ตอน set ทุกครั้งเหมือนโค้ดเดิม
// (ไม่ capture ค่าไว้ตอนสร้าง กัน config เปลี่ยนแล้ว cache ไม่ตาม)
const createTtlCache = ({ maxEntries = 200, getTtlMs = () => 0 } = {}) => {
    const store = new Map(); // key -> { expiresAt, results }
    const get = (key) => {
        const entry = store.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
            store.delete(key);
            return null;
        }
        return entry.results;
    };
    const set = (key, results) => {
        if (store.size >= maxEntries) {
            const oldestKey = store.keys().next().value;
            store.delete(oldestKey);
        }
        store.set(key, { expiresAt: Date.now() + Math.max(0, getTtlMs()), results });
    };
    return { get, set };
};

module.exports = { createTtlCache };
