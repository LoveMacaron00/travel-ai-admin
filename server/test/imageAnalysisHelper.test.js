const test = require('node:test');
const assert = require('node:assert/strict');
const {
    analysisToAnswer,
    detectImageMimeType,
    extractOcrText,
} = require('../controllers/helpers/imageAnalysisHelper');

test('detects supported image signatures instead of trusting upload headers', () => {
    assert.equal(detectImageMimeType(Buffer.from([0xff, 0xd8, 0xff, ...Array(9).fill(0)])), 'image/jpeg');
    assert.equal(
        detectImageMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])),
        'image/png',
    );
    assert.equal(detectImageMimeType(Buffer.from('not an image')), null);
});

test('extracts OCR text from common response shapes', () => {
    assert.equal(extractOcrText('สวัสดี'), 'สวัสดี');
    assert.equal(extractOcrText({ result: { text: 'ทางออก' } }), 'ทางออก');
    assert.equal(extractOcrText([{ text: 'วัด' }, { text: 'เปิด' }]), 'วัด\nเปิด');
});

test('formats structured scan analysis for persisted chat history', () => {
    const answer = analysisToAnswer({
        title: 'Thai sign translation',
        subtitle: '',
        originalText: 'ทางออก',
        translatedText: 'Exit',
        sections: [],
        candidates: [],
        confidence: 0.95,
    });
    assert.match(answer, /Original Thai/);
    assert.match(answer, /English translation/);
    assert.match(answer, /Exit/);
});
