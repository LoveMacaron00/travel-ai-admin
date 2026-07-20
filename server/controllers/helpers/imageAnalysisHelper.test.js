const assert = require('node:assert/strict');
const test = require('node:test');

const { config } = require('../../config/env');
const {
    ImageAnalysisError,
    extractOcrText,
    recognizeText,
} = require('./imageAnalysisHelper');

test('เลือก Original ก่อน Spellcorrection และตัด form-feed จากผล T-OCR', () => {
    const text = extractOcrText({
        Original: 'วัดพระแก้ว\n\f',
        Spellcorrection: 'วัดพระแก้วที่ถูกแก้',
    });

    assert.equal(text, 'วัดพระแก้ว');
});

test('ใช้ Spellcorrection เมื่อ T-OCR ไม่มี Original', () => {
    assert.equal(
        extractOcrText({ Original: '', Spellcorrection: 'ข้อความภาษาไทย' }),
        'ข้อความภาษาไทย',
    );
});

test('ส่ง JPEG ไป T-OCR ด้วย multipart field ชื่อ uploadfile', async (t) => {
    const originalFetch = global.fetch;
    const originalApiKey = config.aiForThai.ocrApiKey;
    const originalUrl = config.aiForThai.ocrUrl;
    t.after(() => {
        global.fetch = originalFetch;
        config.aiForThai.ocrApiKey = originalApiKey;
        config.aiForThai.ocrUrl = originalUrl;
    });

    config.aiForThai.ocrApiKey = 'test-key';
    config.aiForThai.ocrUrl = 'https://example.test/ocr';
    global.fetch = async (url, options) => {
        assert.equal(url, config.aiForThai.ocrUrl);
        assert.equal(options.method, 'POST');
        assert.equal(options.headers.Apikey, 'test-key');
        assert.equal(options.body.get('file'), null);
        const upload = options.body.get('uploadfile');
        assert.equal(upload.name, 'scan.jpg');
        assert.equal(upload.type, 'image/jpeg');
        return {
            ok: true,
            text: async () => JSON.stringify({ Original: 'ป้ายภาษาไทย' }),
        };
    };

    const text = await recognizeText(Buffer.from('jpeg'), 'image/jpeg');
    assert.equal(text, 'ป้ายภาษาไทย');
});

test('รองรับ PNG และไม่ส่งภาพเกิน 1 MB ไป T-OCR', async (t) => {
    const originalFetch = global.fetch;
    const originalApiKey = config.aiForThai.ocrApiKey;
    t.after(() => {
        global.fetch = originalFetch;
        config.aiForThai.ocrApiKey = originalApiKey;
    });

    config.aiForThai.ocrApiKey = 'test-key';
    let fetchCalls = 0;
    global.fetch = async (url, options) => {
        fetchCalls += 1;
        const upload = options.body.get('uploadfile');
        assert.equal(upload.name, 'scan.png');
        assert.equal(upload.type, 'image/png');
        return {
            ok: true,
            text: async () => JSON.stringify({ Original: 'ข้อความไทย' }),
        };
    };

    assert.equal(await recognizeText(Buffer.from('png'), 'image/png'), 'ข้อความไทย');
    await assert.rejects(
        recognizeText(Buffer.alloc((1024 * 1024) + 1), 'image/jpeg'),
        (error) => error instanceof ImageAnalysisError && error.statusCode === 413,
    );
    assert.equal(fetchCalls, 1);
});
