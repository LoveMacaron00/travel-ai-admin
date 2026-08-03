const test = require('node:test');
const assert = require('node:assert/strict');
const { createMobileControllers } = require('../controllers/mobileController');

const responseRecorder = () => {
    const record = { statusCode: 200, body: null, varied: [] };
    return {
        record,
        status(code) {
            record.statusCode = code;
            return this;
        },
        vary(value) {
            record.varied.push(value);
        },
        json(body) {
            record.body = body;
        },
    };
};

test('returns localized province choices with stable database values', async () => {
    const database = {
        async query(_sql, params) {
            assert.deepEqual(params, ['en']);
            return {
                rows: [{
                    value: 'เชียงราย',
                    label: 'Chiang Rai',
                    destination_count: 2,
                }],
            };
        },
    };
    const { getProvinces } = createMobileControllers(database);
    const res = responseRecorder();

    await getProvinces({ get: () => 'en-US', headers: {} }, res);

    assert.equal(res.record.statusCode, 200);
    assert.deepEqual(res.record.body.data, [{
        value: 'เชียงราย',
        label: 'Chiang Rai',
        destinationCount: 2,
    }]);
    assert.deepEqual(res.record.varied, ['Accept-Language']);
});
