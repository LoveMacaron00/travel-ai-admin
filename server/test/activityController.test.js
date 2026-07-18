const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSessionId } = require('../controllers/activityController');

test('accepts positive integer activity session ids', () => {
    assert.equal(parseSessionId(12), 12);
    assert.equal(parseSessionId('42'), 42);
});

test('rejects missing, fractional and negative activity session ids', () => {
    assert.equal(parseSessionId(undefined), null);
    assert.equal(parseSessionId(1.5), null);
    assert.equal(parseSessionId(-1), null);
});
