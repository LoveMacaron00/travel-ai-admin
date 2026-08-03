const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveAllowedMediaUrl } = require('../controllers/mediaController');

const allowedHosts = ['dmc.tatdataapi.io', 'images.unsplash.com'];

test('accepts HTTPS images from an explicitly allowed host', () => {
    const url = resolveAllowedMediaUrl(
        'https://dmc.tatdataapi.io/assets/photo.jpeg',
        allowedHosts,
    );
    assert.equal(url.hostname, 'dmc.tatdataapi.io');
});

test('rejects HTTP, credentials, and lookalike media hosts', () => {
    assert.throws(
        () => resolveAllowedMediaUrl('http://dmc.tatdataapi.io/photo.jpg', allowedHosts),
        /not allowed/,
    );
    assert.throws(
        () => resolveAllowedMediaUrl(
            'https://user:pass@dmc.tatdataapi.io/photo.jpg',
            allowedHosts,
        ),
        /not allowed/,
    );
    assert.throws(
        () => resolveAllowedMediaUrl(
            'https://dmc.tatdataapi.io.evil.example/photo.jpg',
            allowedHosts,
        ),
        /not allowed/,
    );
});
