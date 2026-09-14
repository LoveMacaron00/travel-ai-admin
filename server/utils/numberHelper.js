// แปลงข้อมูลนำเข้าเป็นจำนวนเต็มบวกที่ปลอดภัย หรือคืน null เมื่อใช้เป็นรหัสไม่ได้
const parsePositiveInteger = (value) => {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
};

module.exports = { parsePositiveInteger };
