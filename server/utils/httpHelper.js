// server/utils/httpHelper.js
// ตัวช่วย HTTP ที่ใช้ร่วมกัน — ย้าย fetchWithTimeout ที่นิยามซ้ำใน services มารวมที่นี่
// (logic เดิมทุกประการ: AbortController + clearTimeout ใน finally)

// fetch พร้อม timeout — หมดเวลาแล้ว abort แทนค้าง (caller จัดการ AbortError เอง)
const fetchWithTimeout = async (url, options = {}, timeoutMs) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
};

module.exports = { fetchWithTimeout };
