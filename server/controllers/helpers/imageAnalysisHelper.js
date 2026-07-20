const { config } = require('../../config/env');
const {
    retrieveNearbyPlaces,
    formatPlacesContext,
} = require('./ragHelper');
const { resolveAppLanguage } = require('./appLanguage');

const SCAN_MODES = new Set(['place', 'sign', 'food']);
const T_OCR_MAX_FILE_SIZE = 1024 * 1024;
const T_OCR_MIME_TYPES = new Set(['image/jpeg', 'image/png']);
const IMAGE_COPY = {
    en: {
        originalThai: 'Original Thai',
        englishTranslation: 'English translation',
        otherPossibilities: 'Other possibilities',
        uncertain: 'The identification is uncertain. Try a clearer, closer photo or choose one of the alternatives.',
        signTitle: 'Thai sign translation',
        placeSections: ['What you are seeing', 'Cultural significance', 'Visitor etiquette'],
        foodSections: ['About this dish', 'Cultural context', 'Typical ingredients', 'How it is served', 'Dietary note'],
        unsupportedMode: 'Please choose place, sign, or food.',
        emptyImage: 'Please choose a photo to analyze.',
        invalidImage: 'The uploaded file is not a supported JPEG, PNG, or WebP image.',
    },
    th: {
        originalThai: 'ข้อความภาษาไทยต้นฉบับ',
        englishTranslation: 'คำแปลภาษาอังกฤษ',
        otherPossibilities: 'ตัวเลือกอื่นที่เป็นไปได้',
        uncertain: 'การระบุยังไม่แน่นอน กรุณาลองถ่ายภาพให้ชัดขึ้น ใกล้ขึ้น หรือเลือกจากตัวเลือกอื่น',
        signTitle: 'คำแปลป้ายภาษาไทย',
        placeSections: ['สิ่งที่เห็น', 'ความสำคัญทางวัฒนธรรม', 'มารยาทในการเข้าชม'],
        foodSections: ['เกี่ยวกับอาหารจานนี้', 'บริบททางวัฒนธรรม', 'ส่วนประกอบทั่วไป', 'วิธีเสิร์ฟ', 'ข้อควรระวังด้านอาหาร'],
        unsupportedMode: 'กรุณาเลือกโหมดสถานที่ ป้าย หรืออาหาร',
        emptyImage: 'กรุณาเลือกรูปภาพที่ต้องการวิเคราะห์',
        invalidImage: 'รองรับเฉพาะรูปภาพ JPEG, PNG หรือ WebP ที่ถูกต้อง',
    },
};

const imageCopyFor = (languageCode) => IMAGE_COPY[resolveAppLanguage(languageCode)];

const responseLanguageInstruction = (languageCode) => (
    resolveAppLanguage(languageCode) === 'th'
        ? 'Write all visitor-facing explanatory fields in natural Thai. Keep Thai proper names accurate and do not translate JSON property names.'
        : 'Write all visitor-facing explanatory fields in clear, natural English for international visitors.'
);

// อย่าเชื่อ MIME จาก multipart เพียงอย่างเดียว เพราะ client เป็นผู้ส่งค่านี้มา
const detectImageMimeType = (buffer) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return 'image/jpeg';
    }
    if (
        buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e &&
        buffer[3] === 0x47 && buffer[4] === 0x0d && buffer[5] === 0x0a &&
        buffer[6] === 0x1a && buffer[7] === 0x0a
    ) {
        return 'image/png';
    }
    if (
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
        return 'image/webp';
    }
    return null;
};

const PLACE_SCHEMA = {
    type: 'object',
    required: [
        'title',
        'summary',
        'culturalSignificance',
        'visitorEtiquette',
        'identificationNote',
        'confidence',
    ],
    properties: {
        title: { type: 'string' },
        summary: { type: 'string' },
        culturalSignificance: { type: 'string' },
        visitorEtiquette: { type: 'string' },
        identificationNote: { type: 'string' },
        matchedDestinationName: { type: 'string' },
        confidence: { type: 'number' },
    },
};

const SIGN_SCHEMA = {
    type: 'object',
    required: ['originalText', 'translatedText', 'confidence'],
    properties: {
        originalText: { type: 'string' },
        translatedText: { type: 'string' },
        confidence: { type: 'number' },
    },
};

const FOOD_SCHEMA = {
    type: 'object',
    required: [
        'thaiName',
        'englishName',
        'summary',
        'culturalSignificance',
        'region',
        'typicalIngredients',
        'servingNotes',
        'dietaryCaution',
        'confidence',
    ],
    properties: {
        thaiName: { type: 'string' },
        englishName: { type: 'string' },
        summary: { type: 'string' },
        culturalSignificance: { type: 'string' },
        region: { type: 'string' },
        typicalIngredients: { type: 'string' },
        servingNotes: { type: 'string' },
        dietaryCaution: { type: 'string' },
        confidence: { type: 'number' },
    },
};

class ImageAnalysisError extends Error {
    constructor(message, publicMessage, statusCode = 502) {
        super(message);
        this.publicMessage = publicMessage;
        this.statusCode = statusCode;
    }
}

const clampConfidence = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(1, parsed));
};

const requestWithTimeout = async (url, options, label) => {
    // provider ภายนอกทุกตัวต้องจบภายในเวลาเดียวกันและคืนข้อความที่ปลอดภัยต่อผู้ใช้
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        if (!response.ok) {
            throw new ImageAnalysisError(
                `${label} returned HTTP ${response.status}`,
                `${label} is temporarily unavailable. Please try again.`,
                response.status === 429 ? 429 : 502,
            );
        }
        return response;
    } catch (error) {
        if (error instanceof ImageAnalysisError) throw error;
        const reason = error?.name === 'AbortError' ? 'timed out' : error.message;
        throw new ImageAnalysisError(
            `${label} request ${reason}`,
            `${label} is temporarily unavailable. Please try again.`,
        );
    } finally {
        clearTimeout(timeout);
    }
};

const parseGeminiJson = (text) => {
    const cleaned = String(text || '').replace(/```json|```/gi, '').trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace < 0 || lastBrace <= firstBrace) {
        throw new Error('Gemini returned no JSON object');
    }
    return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
};

async function generateGeminiJson({
    systemPrompt,
    userPrompt,
    schema,
    imageBuffer = null,
    mimeType = 'image/jpeg',
}) {
    if (!config.gemini.apiKey) {
        throw new ImageAnalysisError(
            'GEMINI_API_KEY is missing',
            'Image explanation is not configured yet.',
            503,
        );
    }

    const parts = [{ text: userPrompt }];
    if (imageBuffer) {
        parts.push({
            inlineData: {
                mimeType,
                data: imageBuffer.toString('base64'),
            },
        });
    }

    const body = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048,
            responseMimeType: 'application/json',
            responseJsonSchema: schema,
        },
    };

    const url = `${config.gemini.apiBaseUrl}/models/${config.gemini.model}:generateContent`;
    let lastError;

    for (let attempt = 0; attempt <= config.gemini.maxRetries; attempt++) {
        try {
            const response = await requestWithTimeout(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // ไม่วาง key ใน query string เพื่อป้องกันค่าติด URL log
                    'x-goog-api-key': config.gemini.apiKey,
                },
                body: JSON.stringify(body),
            }, 'AI Guide');
            const payload = await response.json();
            const text = payload.candidates?.[0]?.content?.parts
                ?.map((part) => part.text || '')
                .join('');
            if (!text) throw new Error('Gemini returned no content');
            return parseGeminiJson(text);
        } catch (error) {
            lastError = error;
            const retryable = error.statusCode === 429 || error.statusCode >= 500;
            if (!retryable || attempt === config.gemini.maxRetries) break;
            await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)));
        }
    }

    if (lastError instanceof ImageAnalysisError) throw lastError;
    throw new ImageAnalysisError(
        `Gemini analysis failed: ${lastError?.message || 'unknown error'}`,
        'AI Guide could not analyze this image. Please try another photo.',
    );
}

const buildAnalysis = ({
    mode,
    title,
    subtitle = '',
    confidence = 0,
    sections = [],
    candidates = [],
    provider,
    originalText = '',
    translatedText = '',
}) => ({
    mode,
    title,
    subtitle,
    confidence: clampConfidence(confidence),
    sections: sections.filter((section) => section.body?.trim()),
    candidates,
    provider,
    originalText,
    translatedText,
});

const analysisToAnswer = (analysis, languageCode = 'th') => {
    const copy = imageCopyFor(languageCode);
    const lines = [analysis.title];
    if (analysis.subtitle) lines.push(analysis.subtitle);
    if (analysis.originalText) {
        lines.push(`${copy.originalThai}\n${analysis.originalText}`);
    }
    if (analysis.translatedText) {
        lines.push(`${copy.englishTranslation}\n${analysis.translatedText}`);
    }
    for (const section of analysis.sections) {
        lines.push(`${section.title}\n${section.body}`);
    }
    if (analysis.candidates.length > 1) {
        lines.push(
            `${copy.otherPossibilities}\n${analysis.candidates
                .slice(1, 3)
                .map((candidate) => `${candidate.name} (${Math.round(candidate.score * 100)}%)`)
                .join(', ')}`,
        );
    }
    if (analysis.confidence < 0.8) {
        lines.push(copy.uncertain);
    }
    return lines.filter(Boolean).join('\n\n');
};

const extractOcrText = (value) => {
    if (typeof value === 'string') return value.replace(/\f/g, '').trim();
    if (Array.isArray(value)) {
        return value.map(extractOcrText).filter(Boolean).join('\n').trim();
    }
    if (!value || typeof value !== 'object') return '';
    // T-OCR คืน Original และ Spellcorrection; เลือกต้นฉบับก่อนเพื่อรักษาชื่อเฉพาะบนป้าย
    // ส่วน key อื่นคงไว้รองรับ response รุ่นเก่าและ provider สำรอง
    for (const key of [
        'Original',
        'original',
        'text',
        'result',
        'recognized_text',
        'ocr_text',
        'message',
        'Spellcorrection',
        'spellcorrection',
    ]) {
        const text = extractOcrText(value[key]);
        if (text) return text;
    }
    return '';
};

async function recognizeText(imageBuffer, mimeType) {
    if (!config.aiForThai.ocrApiKey) {
        throw new ImageAnalysisError('OCR key is missing', 'Thai OCR is not configured.', 503);
    }
    if (!T_OCR_MIME_TYPES.has(mimeType)) {
        throw new ImageAnalysisError(
            `T-OCR does not accept ${mimeType}`,
            'Thai OCR currently requires a JPEG or PNG photo.',
            400,
        );
    }
    if (imageBuffer.length > T_OCR_MAX_FILE_SIZE) {
        throw new ImageAnalysisError(
            `T-OCR image exceeds ${T_OCR_MAX_FILE_SIZE} bytes`,
            'Thai OCR currently requires a photo no larger than 1 MB.',
            413,
        );
    }

    const form = new FormData();
    const extension = mimeType === 'image/png' ? 'png' : 'jpg';
    form.append(
        'uploadfile',
        new Blob([imageBuffer], { type: mimeType }),
        `scan.${extension}`,
    );
    const response = await requestWithTimeout(config.aiForThai.ocrUrl, {
        method: 'POST',
        headers: { Apikey: config.aiForThai.ocrApiKey },
        body: form,
    }, 'Thai T-OCR');
    const raw = await response.text();
    let payload = raw;
    try {
        payload = JSON.parse(raw);
    } catch {
        // OCR บางเวอร์ชันคืนข้อความล้วน จึงส่ง raw text เข้า parser ต่อได้
    }
    const text = extractOcrText(payload);
    if (!text || !/[\u0E00-\u0E7F]/.test(text)) {
        throw new ImageAnalysisError(
            'OCR returned no Thai text',
            'No readable Thai text was found in this photo.',
            422,
        );
    }
    return text;
}

async function translateThaiText(text) {
    if (!config.aiForThai.translateApiKey) {
        throw new ImageAnalysisError('Translation key is missing', 'Translation is not configured.', 503);
    }
    const response = await requestWithTimeout(config.aiForThai.translateUrl, {
        method: 'POST',
        headers: {
            Apikey: config.aiForThai.translateApiKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: text.slice(0, 1000) }),
    }, 'Thai translation');
    const payload = await response.json();
    const translatedText = String(payload.translated_text || '').trim();
    if (!translatedText) {
        throw new ImageAnalysisError(
            'Translation returned no text',
            'The Thai text could not be translated.',
            422,
        );
    }
    return translatedText;
}

async function classifyThaiFood(imageBuffer) {
    if (!config.aiForThai.tfoodApiKey) {
        throw new ImageAnalysisError('T-Food key is missing', 'Thai food recognition is not configured.', 503);
    }
    const response = await requestWithTimeout(config.aiForThai.tfoodUrl, {
        method: 'POST',
        headers: {
            Apikey: config.aiForThai.tfoodApiKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ file: imageBuffer.toString('base64') }),
    }, 'Thai food recognition');
    const payload = await response.json();
    const root = Array.isArray(payload) ? payload[0] : payload;
    const objects = Array.isArray(root?.objects) ? root.objects : [];
    const candidates = objects
        .map((item) => ({
            name: String(item.result || item.label || '').replace(/^\((?:น่าจะ|เดาว่า)\)\s*/, '').trim(),
            score: clampConfidence(item.score),
        }))
        .filter((item) => item.name)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
    if (!candidates.length) {
        throw new ImageAnalysisError(
            'T-Food returned no candidates',
            'No Thai dish could be identified in this photo.',
            422,
        );
    }
    return candidates;
}

async function analyzePlace({ imageBuffer, mimeType, latitude, longitude, languageCode }) {
    const copy = imageCopyFor(languageCode);
    // พิกัดเป็น context ช่วยยืนยัน landmark ไม่ใช่หลักฐานว่าภาพคือสถานที่นั้นแน่นอน
    let nearbyPlaces = [];
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        try {
            nearbyPlaces = await retrieveNearbyPlaces(latitude, longitude, 5);
        } catch (error) {
            console.warn('[image-analysis] nearby place lookup failed:', error.message);
        }
    }

    const placeContext = nearbyPlaces.length
        ? formatPlacesContext(nearbyPlaces)
        : 'No verified nearby destination data was available.';
    const result = await generateGeminiJson({
        systemPrompt:
            `You are a careful Thai cultural guide. ${responseLanguageInstruction(languageCode)} ` +
            'Do not claim an exact landmark unless visual evidence and the nearby destination context support it. ' +
            'When uncertain, describe what is visible and say what additional photo would help. ' +
            'If matchedDestinationName is present, copy that destination name exactly from the verified context.',
        userPrompt:
            `Analyze this travel photo. GPS: ${latitude ?? 'unknown'}, ${longitude ?? 'unknown'}.\n\n` +
            `Verified nearby destination context:\n${placeContext}`,
        schema: PLACE_SCHEMA,
        imageBuffer,
        mimeType,
    });

    const matched = nearbyPlaces.find((place) =>
        String(place.name).toLowerCase() === String(result.matchedDestinationName || '').toLowerCase(),
    );
    const analysis = buildAnalysis({
        mode: 'place',
        title: result.title,
        subtitle: result.identificationNote,
        confidence: result.confidence,
        provider: 'gemini',
        sections: [
            { title: copy.placeSections[0], body: result.summary },
            { title: copy.placeSections[1], body: result.culturalSignificance },
            { title: copy.placeSections[2], body: result.visitorEtiquette },
        ],
    });
    return {
        analysis,
        answer: analysisToAnswer(analysis, languageCode),
        sourceChunkIds: matched ? [matched.id] : [],
    };
}

async function analyzeSign({ imageBuffer, mimeType, languageCode }) {
    const copy = imageCopyFor(languageCode);
    try {
        const originalText = await recognizeText(imageBuffer, mimeType);
        const translatedText = await translateThaiText(originalText);
        const analysis = buildAnalysis({
            mode: 'sign',
            title: copy.signTitle,
            confidence: 1,
            provider: 'aiforthai',
            originalText,
            translatedText,
        });
        return { analysis, answer: analysisToAnswer(analysis, languageCode), sourceChunkIds: [] };
    } catch (primaryError) {
        // Gemini เป็น fallback เพื่อให้ผู้ใช้ยังอ่านป้ายได้เมื่อ AI for Thai ล่ม
        // หรือภาพไม่ตรงข้อจำกัดด้านชนิดและขนาดไฟล์ของ T-OCR
        console.warn('[image-analysis] AI for Thai sign flow failed:', primaryError.message);
        const result = await generateGeminiJson({
            systemPrompt:
                'Read Thai text from travel signs and translate it into natural English. ' +
                'Preserve place names and line breaks where useful. Do not invent unreadable text. ' +
                'Always return originalText in Thai and translatedText in English, regardless of the UI language.',
            userPrompt: 'Extract the visible Thai text and translate it to English.',
            schema: SIGN_SCHEMA,
            imageBuffer,
            mimeType,
        });
        const analysis = buildAnalysis({
            mode: 'sign',
            title: copy.signTitle,
            confidence: result.confidence,
            provider: 'gemini_fallback',
            originalText: result.originalText,
            translatedText: result.translatedText,
        });
        return { analysis, answer: analysisToAnswer(analysis, languageCode), sourceChunkIds: [] };
    }
}

async function explainFoodCandidate(candidates, languageCode) {
    const names = candidates.map((candidate) =>
        `${candidate.name} (${Math.round(candidate.score * 100)}%)`,
    ).join(', ');
    return generateGeminiJson({
        systemPrompt:
            `You are a careful Thai food and culture guide. ${responseLanguageInstruction(languageCode)} ` +
            'Keep thaiName in Thai and englishName in English. ' +
            'Describe common ingredients only; never guarantee allergens, halal status, or exact recipe from an image.',
        userPrompt:
            `T-Food returned these possible dishes: ${names}. Explain the top candidate for an international visitor, ` +
            'while reflecting uncertainty when its score is below 0.8.',
        schema: FOOD_SCHEMA,
    });
}

async function analyzeFood({ imageBuffer, mimeType, languageCode }) {
    const copy = imageCopyFor(languageCode);
    let candidates = [];
    let result;
    let provider = 'aiforthai+gemini';
    try {
        candidates = await classifyThaiFood(imageBuffer);
        result = await explainFoodCandidate(candidates, languageCode);
        result.confidence = candidates[0].score;
        result.thaiName = candidates[0].name;
    } catch (primaryError) {
        // หาก T-Food ไม่มีผลลัพธ์ ให้ vision model วิเคราะห์แทนและลดความแน่นอนตามผลจริง
        console.warn('[image-analysis] T-Food flow failed:', primaryError.message);
        provider = 'gemini_fallback';
        result = await generateGeminiJson({
            systemPrompt:
                `Identify Thai food carefully. ${responseLanguageInstruction(languageCode)} ` +
                'Keep thaiName in Thai and englishName in English. ' +
                'Never guarantee allergens, halal status, or exact ingredients from appearance alone.',
            userPrompt: 'Identify this dish and explain its cultural context, typical ingredients, and how it is served.',
            schema: FOOD_SCHEMA,
            imageBuffer,
            mimeType,
        });
        candidates = [{ name: result.thaiName, score: clampConfidence(result.confidence) }];
    }

    const title = result.englishName
        ? `${result.thaiName} · ${result.englishName}`
        : result.thaiName;
    const analysis = buildAnalysis({
        mode: 'food',
        title,
        subtitle: result.region,
        confidence: result.confidence,
        candidates,
        provider,
        sections: [
            { title: copy.foodSections[0], body: result.summary },
            { title: copy.foodSections[1], body: result.culturalSignificance },
            { title: copy.foodSections[2], body: result.typicalIngredients },
            { title: copy.foodSections[3], body: result.servingNotes },
            { title: copy.foodSections[4], body: result.dietaryCaution },
        ],
    });
    return { analysis, answer: analysisToAnswer(analysis, languageCode), sourceChunkIds: [] };
}

async function analyzeTravelImage({
    mode,
    imageBuffer,
    mimeType,
    latitude,
    longitude,
    languageCode,
}) {
    const resolvedLanguageCode = resolveAppLanguage(languageCode);
    const copy = imageCopyFor(resolvedLanguageCode);
    // จุดเข้าเดียวของทั้งสามโหมด: validate ไฟล์ก่อนเลือก pipeline ของ provider
    if (!SCAN_MODES.has(mode)) {
        throw new ImageAnalysisError('Unsupported scan mode', copy.unsupportedMode, 400);
    }
    if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
        throw new ImageAnalysisError('Image is empty', copy.emptyImage, 400);
    }
    const detectedMimeType = detectImageMimeType(imageBuffer);
    if (!detectedMimeType) {
        throw new ImageAnalysisError(
            'Image signature is invalid',
            copy.invalidImage,
            400,
        );
    }

    if (mode === 'place') {
        return analyzePlace({
            imageBuffer,
            mimeType: detectedMimeType,
            latitude,
            longitude,
            languageCode: resolvedLanguageCode,
        });
    }
    if (mode === 'sign') {
        return analyzeSign({
            imageBuffer,
            mimeType: detectedMimeType,
            languageCode: resolvedLanguageCode,
        });
    }
    return analyzeFood({
        imageBuffer,
        mimeType: detectedMimeType,
        languageCode: resolvedLanguageCode,
    });
}

module.exports = {
    analyzeTravelImage,
    detectImageMimeType,
};
