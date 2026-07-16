const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { adminJwtSecret } = require('../config/jwtSecrets');
const { secureUploads } = require('../middleware/secureUploads');

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

test('rejects JWT supplied through a query string', async () => {
    const token = jwt.sign({ id: 1 }, adminJwtSecret);
    const req = { query: { token }, headers: {} };
    const res = createResponse();
    let calledNext = false;

    await secureUploads(req, res, () => { calledNext = true; });

    assert.equal(res.statusCode, 401);
    assert.equal(calledNext, false);
});

test('accepts a valid admin Bearer token', async () => {
    const token = jwt.sign({ id: 1 }, adminJwtSecret);
    const req = { query: {}, headers: { authorization: `Bearer ${token}` } };
    const res = createResponse();
    let calledNext = false;

    await secureUploads(req, res, () => { calledNext = true; });

    assert.equal(res.statusCode, 200);
    assert.equal(calledNext, true);
});
