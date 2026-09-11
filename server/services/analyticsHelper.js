const analyticsRanges = Object.freeze({
    '24h': {
        key: '24h',
        label: '24 Hours',
        lookback: '24 hours',
        bucketUnit: 'hour',
        bucketStep: '1 hour',
        bucketOffset: '23 hours',
        labelFormat: 'HH24:00',
    },
    '7d': {
        key: '7d',
        label: '7 Days',
        lookback: '7 days',
        bucketUnit: 'day',
        bucketStep: '1 day',
        bucketOffset: '6 days',
        labelFormat: 'DD Mon',
    },
    '30d': {
        key: '30d',
        label: '30 Days',
        lookback: '30 days',
        bucketUnit: 'day',
        bucketStep: '1 day',
        bucketOffset: '29 days',
        labelFormat: 'DD Mon',
    },
    '90d': {
        key: '90d',
        label: '90 Days',
        lookback: '90 days',
        bucketUnit: 'day',
        bucketStep: '1 day',
        bucketOffset: '89 days',
        labelFormat: 'DD Mon',
    },
});

// คืนค่าช่วงเวลาสถิติที่รองรับ โดยใช้ 30 วันเมื่อ query ไม่ถูกต้อง
const getAnalyticsRange = (value) => analyticsRanges[value] ?? analyticsRanges['30d'];

// คำนวณเปอร์เซ็นต์การเปลี่ยนแปลง โดยแยกกรณีฐานเดิมเป็นศูนย์
const calculateGrowth = (current, previous) => {
    if (previous === 0) return current === 0 ? 0 : null;
    return Number((((current - previous) / previous) * 100).toFixed(1));
};

// แปลงชั่วโมง 0-23 เป็นข้อความช่วงเวลาหนึ่งชั่วโมง
const formatPeakUsageTime = (hour) => {
    if (!Number.isInteger(hour)) return null;
    const endHour = (hour + 1) % 24;
    return `${String(hour).padStart(2, '0')}:00 - ${String(endHour).padStart(2, '0')}:00`;
};

module.exports = {
    calculateGrowth,
    formatPeakUsageTime,
    getAnalyticsRange,
};
