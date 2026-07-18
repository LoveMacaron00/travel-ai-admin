const test = require('node:test');
const assert = require('node:assert/strict');
const {
    calculateGrowth,
    formatPeakUsageTime,
    getAnalyticsRange,
} = require('../controllers/helpers/analyticsHelper');

test('accepts only supported analytics ranges', () => {
    assert.equal(getAnalyticsRange('24h').key, '24h');
    assert.equal(getAnalyticsRange('90d').key, '90d');
    assert.equal(getAnalyticsRange('anything').key, '30d');
});

test('calculates monthly growth and handles a new first month', () => {
    assert.equal(calculateGrowth(120, 100), 20);
    assert.equal(calculateGrowth(80, 100), -20);
    assert.equal(calculateGrowth(0, 0), 0);
    assert.equal(calculateGrowth(4, 0), null);
});

test('formats a one-hour peak window including midnight rollover', () => {
    assert.equal(formatPeakUsageTime(19), '19:00 - 20:00');
    assert.equal(formatPeakUsageTime(23), '23:00 - 00:00');
    assert.equal(formatPeakUsageTime(undefined), null);
});
