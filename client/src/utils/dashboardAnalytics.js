export const analyticsRanges = [
    { key: '24h', label: '24 ชั่วโมง' },
    { key: '7d', label: '7 วัน' },
    { key: '30d', label: '30 วัน' },
    { key: '90d', label: '90 วัน' },
];

export const formatPeriodLabel = (value) => ({
    '24 Hours': '24 ชั่วโมง',
    '7 Days': '7 วัน',
    '30 Days': '30 วัน',
    '90 Days': '90 วัน',
}[value] || value || 'ช่วงเวลาที่เลือก');

export const formatDuration = (seconds) => {
    const totalSeconds = Math.max(0, Number(seconds) || 0);
    if (totalSeconds < 60) return `${Math.round(totalSeconds)} วินาที`;

    const totalMinutes = Math.round(totalSeconds / 60);
    if (totalMinutes < 60) return `${totalMinutes} นาที`;

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes === 0 ? `${hours} ชั่วโมง` : `${hours} ชั่วโมง ${minutes} นาที`;
};

export const formatUpdatedAt = (value, timeZone = 'Asia/Bangkok') => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'ยังไม่มีการอัปเดต';
    return new Intl.DateTimeFormat('th-TH', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone,
    }).format(date);
};

const numberOrZero = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
};

/** ตรวจ API contract ก่อน render เพื่อให้ backend คนละเวอร์ชันแสดง error แทนหน้า crash */
export const normalizeAnalyticsPayload = (payload) => {
    if (
        payload == null
        || typeof payload !== 'object'
        || payload.summary == null
        || typeof payload.summary !== 'object'
        || !Array.isArray(payload.trendData)
        || !Array.isArray(payload.topDestinations)
    ) {
        throw new Error('ข้อมูลจาก Analytics API ไม่ตรงกับเวอร์ชันนี้ กรุณารีสตาร์ตเซิร์ฟเวอร์ที่อัปเดตแล้ว');
    }

    return {
        ...payload,
        timeZone: typeof payload.timeZone === 'string' && payload.timeZone
            ? payload.timeZone
            : 'Asia/Bangkok',
        summary: {
            ...payload.summary,
            activeUsersNow: numberOrZero(payload.summary.activeUsersNow),
            totalRegisteredUsers: numberOrZero(payload.summary.totalRegisteredUsers),
            monthlyActiveUsers: numberOrZero(payload.summary.monthlyActiveUsers),
            monthlyUserGrowth: payload.summary.monthlyUserGrowth == null
                ? null
                : numberOrZero(payload.summary.monthlyUserGrowth),
            averageSessionSeconds: numberOrZero(payload.summary.averageSessionSeconds),
            totalSessions: numberOrZero(payload.summary.totalSessions),
            monthlyDestinationViews: numberOrZero(payload.summary.monthlyDestinationViews),
            monthlyUniqueDestinationViewers: numberOrZero(
                payload.summary.monthlyUniqueDestinationViewers,
            ),
            periodDestinationViews: numberOrZero(payload.summary.periodDestinationViews),
            periodUniqueDestinationViewers: numberOrZero(
                payload.summary.periodUniqueDestinationViewers,
            ),
        },
        trendData: payload.trendData.map((point) => ({
            ...point,
            activeUsers: numberOrZero(point.activeUsers),
            sessions: numberOrZero(point.sessions),
            destinationViews: numberOrZero(point.destinationViews),
            uniqueDestinationViewers: numberOrZero(point.uniqueDestinationViewers),
        })),
        topDestinations: payload.topDestinations.map((destination) => ({
            ...destination,
            viewer: numberOrZero(destination.viewer),
            uniqueViewers: numberOrZero(destination.uniqueViewers),
        })),
    };
};

export const normalizeDestinationTrendPayload = (payload) => {
    if (payload == null || !Array.isArray(payload.trendData)) {
        throw new Error('ข้อมูลแนวโน้มสถานที่ไม่ตรงกับรูปแบบที่รองรับ');
    }
    return payload.trendData.map((point) => ({
        ...point,
        views: numberOrZero(point.views),
        uniqueViewers: numberOrZero(point.uniqueViewers),
    }));
};

const escapeCsvValue = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;

export const buildAnalyticsCsv = (stats) => {
    const summary = stats.summary ?? {};
    const rows = [
        ['สร้างรายงานสถิติการใช้งานเมื่อ', stats.generatedAt],
        ['ช่วงเวลาที่เลือก', formatPeriodLabel(stats.periodLabel)],
        ['เขตเวลา', stats.timeZone],
        [],
        ['ตัวชี้วัด', 'ค่า'],
        ['ผู้ใช้ที่ใช้งานขณะนี้', summary.activeUsersNow],
        ['ผู้ใช้ที่ลงทะเบียนทั้งหมด', summary.totalRegisteredUsers],
        ['ผู้ใช้ต่อเดือน', summary.monthlyActiveUsers],
        ['การเติบโตรายเดือน (%)', summary.monthlyUserGrowth ?? 'ใหม่'],
        ['ระยะเวลาใช้งานเฉลี่ย (วินาที)', summary.averageSessionSeconds],
        ['ช่วงเวลาที่มีผู้ใช้สูงสุด', summary.peakUsageTime ?? 'ไม่มีข้อมูล'],
        ['เซสชันในช่วงเวลาที่เลือก', summary.totalSessions],
        ['ยอดดูสถานที่รายเดือน', summary.monthlyDestinationViews],
        ['ผู้ชมสถานที่ไม่ซ้ำรายเดือน', summary.monthlyUniqueDestinationViewers],
        ['ยอดดูสถานที่ในช่วงเวลาที่เลือก', summary.periodDestinationViews],
        ['ผู้ชมสถานที่ไม่ซ้ำในช่วงเวลาที่เลือก', summary.periodUniqueDestinationViewers],
        [],
        ['ช่วงเวลา', 'ผู้ใช้ที่ใช้งาน', 'เซสชัน', 'ยอดดูสถานที่', 'ผู้ชมสถานที่ไม่ซ้ำ'],
        ...(stats.trendData ?? []).map((point) => [
            point.key,
            point.activeUsers,
            point.sessions,
            point.destinationViews,
            point.uniqueDestinationViewers,
        ]),
        [],
        ['สถานที่ยอดนิยม', 'ยอดดู', 'ผู้ชมไม่ซ้ำ'],
        ...(stats.topDestinations ?? []).map((destination) => [
            destination.name,
            destination.viewer,
            destination.uniqueViewers,
        ]),
    ];

    return rows.map((row) => row.map(escapeCsvValue).join(',')).join('\r\n');
};
