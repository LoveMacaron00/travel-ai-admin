// แปลง input เป็นจำนวนเต็มบวกที่ปลอดภัย หรือคืน null เมื่อใช้เป็น id ไม่ได้
const parsePositiveInteger = (value) => {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
};

module.exports = { parsePositiveInteger };
