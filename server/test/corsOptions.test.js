const test = require('node:test');
const assert = require('node:assert/strict');
const { isOriginAllowed } = require('../config/corsOptions');

const baseConfig = {
    allowedOrigins: ['https://app.example.com'],
    nodeEnv: 'production',
};

test('allows requests without an Origin header for mobile clients', () => {
    assert.equal(isOriginAllowed({ ...baseConfig, origin: undefined }), true);
});

test('allows an explicitly configured production origin', () => {
    assert.equal(
        isOriginAllowed({ ...baseConfig, origin: 'https://app.example.com/' }),
        true,
    );
});

test('rejects unconfigured origins in production', () => {
    assert.equal(
        isOriginAllowed({ ...baseConfig, origin: 'https://untrusted.example' }),
        false,
    );
    assert.equal(
        isOriginAllowed({ ...baseConfig, origin: 'http://localhost:7357' }),
        false,
    );
});

test('allows Flutter web on any loopback port outside production', () => {
    const development = { ...baseConfig, nodeEnv: 'development' };
    assert.equal(
        isOriginAllowed({ ...development, origin: 'http://localhost:7357' }),
        true,
    );
    assert.equal(
        isOriginAllowed({ ...development, origin: 'http://127.0.0.1:49152' }),
        true,
    );
    assert.equal(
        isOriginAllowed({ ...development, origin: 'http://[::1]:8080' }),
        true,
    );
    assert.equal(
        isOriginAllowed({
            ...development,
            origin: 'http://localhost.example:7357',
        }),
        false,
    );
});
