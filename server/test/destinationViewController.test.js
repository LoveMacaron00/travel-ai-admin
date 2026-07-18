const test = require('node:test');
const assert = require('node:assert/strict');
const { createRecordDestinationView } = require('../controllers/destinationViewController');

const createResponse = () => ({
    statusCode: 200,
    body: null,
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(body) {
        this.body = body;
        return this;
    },
});

test('records the first destination view in an activity session', async () => {
    const database = {
        query: async (_sql, values) => {
            assert.deepEqual(values, [8, 3, 21]);
            return {
                rows: [{ destination_exists: true, session_exists: true, recorded: true }],
            };
        },
    };
    const controller = createRecordDestinationView(database);
    const response = createResponse();

    await controller(
        { params: { id: '8' }, body: { sessionId: 21 }, user: { id: 3 } },
        response,
    );

    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.body, { recorded: true, duplicate: false });
});

test('returns success without incrementing a duplicate session view', async () => {
    const controller = createRecordDestinationView({
        query: async () => ({
            rows: [{ destination_exists: true, session_exists: true, recorded: false }],
        }),
    });
    const response = createResponse();

    await controller(
        { params: { id: '8' }, body: { sessionId: 21 }, user: { id: 3 } },
        response,
    );

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { recorded: false, duplicate: true });
});

test('rejects a view without a valid destination and session id', async () => {
    const controller = createRecordDestinationView({
        query: async () => assert.fail('database should not be queried'),
    });
    const response = createResponse();

    await controller(
        { params: { id: 'invalid' }, body: {}, user: { id: 3 } },
        response,
    );

    assert.equal(response.statusCode, 400);
});
