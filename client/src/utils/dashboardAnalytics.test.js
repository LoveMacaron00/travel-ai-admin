import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildAnalyticsCsv,
    formatDuration,
    formatUpdatedAt,
    normalizeAnalyticsPayload,
    normalizeDestinationTrendPayload,
} from './dashboardAnalytics.js';

test('formats session durations for seconds, minutes and hours', () => {
    assert.equal(formatDuration(42), '42 sec');
    assert.equal(formatDuration(180), '3 min');
    assert.equal(formatDuration(5_400), '1 hr 30 min');
});

test('returns a safe label for an invalid update timestamp', () => {
    assert.equal(formatUpdatedAt('not-a-date'), 'Not updated yet');
});

test('exports summary and trend data as escaped CSV', () => {
    const csv = buildAnalyticsCsv({
        generatedAt: '2026-07-17T00:00:00.000Z',
        periodLabel: '30 Days',
        timeZone: 'Asia/Bangkok',
        summary: {
            activeUsersNow: 2,
            totalRegisteredUsers: 10,
            monthlyActiveUsers: 7,
            monthlyUserGrowth: 16.7,
            averageSessionSeconds: 120,
            peakUsageTime: '19:00 - 20:00',
            totalSessions: 12,
            monthlyDestinationViews: 20,
            monthlyUniqueDestinationViewers: 8,
            periodDestinationViews: 20,
            periodUniqueDestinationViewers: 8,
        },
        trendData: [{
            key: '2026-07-17T00:00:00',
            activeUsers: 2,
            sessions: 3,
            destinationViews: 5,
            uniqueDestinationViewers: 4,
        }],
        topDestinations: [{ name: 'Temple', viewer: 5, uniqueViewers: 4 }],
    });

    assert.match(csv, /"Active users now","2"/);
    assert.match(csv, /"2026-07-17T00:00:00","2","3"/);
    assert.match(csv, /"Temple","5","4"/);
});

test('normalizes a selected destination trend', () => {
    const trend = normalizeDestinationTrendPayload({
        trendData: [{ key: 'day-1', views: '5', uniqueViewers: '3' }],
    });

    assert.deepEqual(trend, [{ key: 'day-1', views: 5, uniqueViewers: 3 }]);
});

test('rejects an outdated analytics API shape before rendering', () => {
    assert.throws(
        () => normalizeAnalyticsPayload({ monthlyActiveUsers: 10 }),
        /incompatible/,
    );
});
