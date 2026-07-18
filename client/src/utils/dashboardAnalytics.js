export const analyticsRanges = [
    { key: '24h', label: '24 Hours' },
    { key: '7d', label: '7 Days' },
    { key: '30d', label: '30 Days' },
    { key: '90d', label: '90 Days' },
];

export const formatDuration = (seconds) => {
    const totalSeconds = Math.max(0, Number(seconds) || 0);
    if (totalSeconds < 60) return `${Math.round(totalSeconds)} sec`;

    const totalMinutes = Math.round(totalSeconds / 60);
    if (totalMinutes < 60) return `${totalMinutes} min`;

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
};

export const formatUpdatedAt = (value, timeZone = 'Asia/Bangkok') => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Not updated yet';
    return new Intl.DateTimeFormat('en-GB', {
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
        throw new Error('Analytics API response is incompatible. Please restart the updated server.');
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
        throw new Error('Destination trend response is incompatible.');
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
        ['Usage Analytics generated at', stats.generatedAt],
        ['Selected period', stats.periodLabel],
        ['Time zone', stats.timeZone],
        [],
        ['Metric', 'Value'],
        ['Active users now', summary.activeUsersNow],
        ['Total registered users', summary.totalRegisteredUsers],
        ['Monthly active users', summary.monthlyActiveUsers],
        ['Monthly growth (%)', summary.monthlyUserGrowth ?? 'New'],
        ['Average session (seconds)', summary.averageSessionSeconds],
        ['Peak usage time', summary.peakUsageTime ?? 'No data'],
        ['Sessions in selected period', summary.totalSessions],
        ['Monthly destination views', summary.monthlyDestinationViews],
        ['Monthly unique destination viewers', summary.monthlyUniqueDestinationViewers],
        ['Destination views in selected period', summary.periodDestinationViews],
        ['Unique destination viewers in selected period', summary.periodUniqueDestinationViewers],
        [],
        ['Time bucket', 'Active users', 'Sessions', 'Destination views', 'Unique destination viewers'],
        ...(stats.trendData ?? []).map((point) => [
            point.key,
            point.activeUsers,
            point.sessions,
            point.destinationViews,
            point.uniqueDestinationViewers,
        ]),
        [],
        ['Popular destination', 'Views', 'Unique viewers'],
        ...(stats.topDestinations ?? []).map((destination) => [
            destination.name,
            destination.viewer,
            destination.uniqueViewers,
        ]),
    ];

    return rows.map((row) => row.map(escapeCsvValue).join(',')).join('\r\n');
};
