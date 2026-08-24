const { config } = require('../../config/env');
const {
    findDestinationByNames,
    formatPlacesContext,
    retrieveNearbyPlaces,
} = require('./ragHelper');
const { resolveAppLanguage } = require('./appLanguage');

const SCAN_MODES = new Set(['place', 'sign', 'food']);
const T_OCR_MAX_FILE_SIZE = 1024 * 1024;
const T_OCR_MIME_TYPES = new Set(['image/jpeg', 'image/png']);
const FOOD_VISION_VERIFY_THRESHOLD = 0.65;
const FOOD_PLAUSIBLE_CANDIDATE_THRESHOLD = 0.5;
const IMAGE_COPY = {
    en: {
        originalThai: 'Original Thai',
        englishTranslation: 'English translation',
        otherPossibilities: 'Other possibilities',
        uncertain: 'The identification is uncertain. Try a clearer, closer photo or choose one of the alternatives.',
        signTitle: 'Thai sign translation',
        placeSections: ['What you are seeing', 'Cultural significance', 'Visitor etiquette'],
        foodSections: ['About this dish', 'Cultural context', 'Typical ingredients', 'How it is served', 'Dietary note'],
        foodUncertainTitle: 'Dish not identified confidently',
        foodUncertainSubtitle: 'Try a clearer photo showing the whole dish and its main ingredients.',
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
        foodUncertainTitle: 'ยังระบุอาหารไม่ได้แน่ชัด',
        foodUncertainSubtitle: 'ลองถ่ายให้เห็นอาหารทั้งจานและส่วนประกอบหลักชัดขึ้น',
        unsupportedMode: 'กรุณาเลือกโหมดสถานที่ ป้าย หรืออาหาร',
        emptyImage: 'กรุณาเลือกรูปภาพที่ต้องการวิเคราะห์',
        invalidImage: 'รองรับเฉพาะรูปภาพ JPEG, PNG หรือ WebP ที่ถูกต้อง',
    },
};

// เลือกชุดข้อความตอบกลับสำหรับการวิเคราะห์ภาพตามภาษา
const imageCopyFor = (languageCode) => IMAGE_COPY[resolveAppLanguage(languageCode)];

// สร้างคำสั่งภาษาเพื่อบังคับให้ Gemini ตอบในภาษาที่ร้องขอ
const responseLanguageInstruction = (languageCode) => (
    resolveAppLanguage(languageCode) === 'th'
        ? 'Write all visitor-facing explanatory fields in natural Thai. Keep Thai proper names accurate and do not translate JSON property names.'
        : 'Write all visitor-facing explanatory fields in clear, natural English for international visitors.'
);

// อย่าเชื่อ MIME จาก multipart เพียงอย่างเดียว เพราะ client เป็นผู้ส่งค่านี้มา
// ตรวจ MIME type จาก magic bytes ของไฟล์ภาพ ไม่เชื่อ header เพียงอย่างเดียว
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

// Error เฉพาะทางที่แนบ HTTP status และข้อมูล provider สำหรับส่งกลับ client
class ImageAnalysisError extends Error {
    constructor(message, publicMessage, statusCode = 502, retryAfterSeconds = null) {
        super(message);
        this.publicMessage = publicMessage;
        this.statusCode = statusCode;
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

// จำกัดค่าความมั่นใจให้อยู่ระหว่าง 0 ถึง 1
const clampConfidence = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(1, parsed));
};

// อ่านเวลาที่ควรรอก่อน retry จาก response ของผู้ให้บริการ
const parseRetryAfterSeconds = (response, errorPayload) => {
    const headerSeconds = Number(response.headers.get('retry-after'));
    if (Number.isFinite(headerSeconds) && headerSeconds > 0) {
        return Math.ceil(headerSeconds);
    }

    const retryInfo = errorPayload?.error?.details?.find((detail) =>
        typeof detail?.retryDelay === 'string',
    );
    const payloadSeconds = Number.parseFloat(retryInfo?.retryDelay || '');
    return Number.isFinite(payloadSeconds) && payloadSeconds > 0
        ? Math.ceil(payloadSeconds)
        : null;
};

// ส่ง HTTP request พร้อม timeout และแปลงข้อผิดพลาดเป็น ImageAnalysisError
const requestWithTimeout = async (url, options, label) => {
    // provider ภายนอกทุกตัวต้องจบภายในเวลาเดียวกันและคืนข้อความที่ปลอดภัยต่อผู้ใช้
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        if (!response.ok) {
            const rawError = await response.text();
            let errorPayload = null;
            try {
                errorPayload = JSON.parse(rawError);
            } catch {
                // provider บางครั้งคืน error เป็นข้อความล้วน
            }
            const retryAfterSeconds = parseRetryAfterSeconds(response, errorPayload);
            const providerStatus = errorPayload?.error?.status;
            throw new ImageAnalysisError(
                `${label} returned HTTP ${response.status}${providerStatus ? ` ${providerStatus}` : ''}`,
                `${label} is temporarily unavailable. Please try again.`,
                response.status === 429 ? 429 : 502,
                retryAfterSeconds,
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

// แกะ JSON ที่ Gemini อาจส่งพร้อม markdown code fence
const parseGeminiJson = (text) => {
    const cleaned = String(text || '').replace(/```json|```/gi, '').trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace < 0 || lastBrace <= firstBrace) {
        throw new Error('Gemini returned no JSON object');
    }
    return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
};

// ขอผลวิเคราะห์ JSON จาก Gemini พร้อมการตรวจ status และ retry
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
            // HTTP 200 ที่ content ว่าง/JSON ไม่ครบ และ 5xx สามารถ retry ได้
            // แต่ 429 ต้องคืนให้ client รอตาม quota window ไม่ยิงซ้ำถี่กว่าเดิม
            const retryable = !(error instanceof ImageAnalysisError) ||
                error.statusCode >= 500;
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

// Gemini รุ่น 1.5 ใช้ tool ชื่อ google_search_retrieval ส่วน 2.0 ขึ้นไปใช้ google_search
const googleSearchTool = () =>
    /gemini-1\.[05]/.test(config.gemini.model)
        ? { google_search_retrieval: {} }
        : { google_search: {} };

// ขอผลวิเคราะห์ JSON จาก Gemini พร้อม Google Search grounding
// grounding ใช้ร่วมกับ responseMimeType JSON ไม่ได้ จึงฝังรูปแบบ JSON ไว้ใน prompt แทน
async function generateGeminiJsonWithSearch({
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
        },
        tools: [googleSearchTool()],
    };

    const url = `${config.gemini.apiBaseUrl}/models/${config.gemini.model}:generateContent`;
    const response = await requestWithTimeout(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': config.gemini.apiKey,
        },
        body: JSON.stringify(body),
    }, 'AI Guide search');
    const payload = await response.json();
    const text = payload.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || '')
        .join('');
    if (!text) throw new Error('Gemini returned no content');
    const parsed = parseGeminiJson(text);
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Gemini search returned no JSON object');
    }
    return parsed;
}

// ใช้ Google Search grounding ก่อนเพื่อความแม่นยำ ถ้า grounding ใช้ไม่ได้
// (โมเดล/พื้นที่บริการไม่รองรับ หรือ JSON เสียหาย) ค่อยตอบจากความรู้ของโมเดลอย่างเดียว
async function generateGeminiJsonPreferSearch(options) {
    try {
        return await generateGeminiJsonWithSearch(options);
    } catch (error) {
        console.warn(`[image-analysis] grounded generation failed: ${error.message}`);
        return generateGeminiJson(options);
    }
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

// แปลงผลวิเคราะห์เชิงโครงสร้างเป็นข้อความตอบกลับสำหรับแชท
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

// ดึงข้อความ OCR จากรูปแบบ response หลายชนิดของ AI for Thai
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

// ส่งภาพไป OCR ของ AI for Thai และคืนข้อความที่อ่านได้
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

// แปลข้อความไทยเป็นอังกฤษผ่าน AI for Thai เมื่อมีข้อความให้แปล
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

// ส่งภาพไปจำแนกอาหารไทยผ่าน AI for Thai
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

// วิเคราะห์สถานที่จากภาพและพิกัดด้วย Gemini
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
    const result = await generateGeminiJsonWithSearch({
        systemPrompt:
            `You are a careful Thai cultural guide. ${responseLanguageInstruction(languageCode)} ` +
            'Use Google Search results to verify what the photo shows, especially when the verified destination ' +
            'context is insufficient or does not match the visual evidence. ' +
            'Do not claim an exact landmark unless visual evidence, search results, or the nearby destination ' +
            'context support it. If the landmark is not in the verified context, still identify it from visual ' +
            'and search evidence, and say in identificationNote that it is not yet in the verified database. ' +
            'When uncertain, describe what is visible and say what additional photo would help. ' +
            'If matchedDestinationName is present, copy that destination name exactly from the verified context.',
        userPrompt:
            `Analyze this travel photo. GPS: ${latitude ?? 'unknown'}, ${longitude ?? 'unknown'}.\n\n` +
            `Verified nearby destination context:\n${placeContext}`,
        schema: PLACE_SCHEMA,
        imageBuffer,
        mimeType,
    });

    let matched = nearbyPlaces.find((place) =>
        String(place.name).toLowerCase() === String(result.matchedDestinationName || '').toLowerCase(),
    );
    if (!matched && clampConfidence(result.confidence) >= 0.8) {
        matched = await findDestinationByNames([
            result.matchedDestinationName,
            result.title,
        ]);
    }
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
        illustrationUrl: matched?.image_url || null,
    };
}

// อ่านและอธิบายป้ายจากภาพด้วย OCR และ Gemini
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

// รวมชื่ออาหารที่มาจาก vision และ service จำแนกอาหารโดยไม่ให้ซ้ำ
const mergeFoodCandidates = (visionResult, candidates) => {
    const visionName = String(visionResult.thaiName || '').trim();
    const normalizedVisionName = visionName.toLowerCase();
    const merged = visionName
        ? [{ name: visionName, score: clampConfidence(visionResult.confidence) }]
        : [];
    for (const candidate of candidates) {
        if (candidate.name.toLowerCase() === normalizedVisionName) continue;
        merged.push(candidate);
    }
    return merged.slice(0, 3);
};

// ขอคำอธิบายอาหารผู้สมัครจาก Gemini ตามภาพและภาษาที่เลือก
async function explainFoodCandidate(
    candidates,
    languageCode,
    imageBuffer,
    mimeType,
) {
    const names = candidates.map((candidate) =>
        `${candidate.name} (${Math.round(candidate.score * 100)}%)`,
    ).join(', ');
    return generateGeminiJsonWithSearch({
        systemPrompt:
            `You are a careful Thai food and culture guide. ${responseLanguageInstruction(languageCode)} ` +
            'Use Google Search results to verify the dish name, its region, typical ingredients, and cultural context ' +
            'so the explanation is accurate rather than from memory alone. ' +
            'Keep thaiName in Thai and englishName in English. ' +
            'Check that the visible dish is consistent with the classifier candidate before explaining it. ' +
            'Describe common ingredients only. In dietaryCaution, mention only potential allergens supported by visible ' +
            'ingredients or the typical recipe, explicitly say recipes vary by vendor, and never guarantee allergens, ' +
            'halal status, or the exact recipe from appearance alone. Never claim rice noodles contain gluten; mention ' +
            'possible gluten only when a sauce or another wheat-based ingredient may contain it.',
        userPrompt:
            `T-Food returned these possible dishes: ${names}. Explain the top candidate for an international visitor, ` +
            'while reflecting uncertainty when its score is below 0.8.',
        schema: FOOD_SCHEMA,
        imageBuffer,
        mimeType,
    });
}

// ให้ Gemini ยืนยันหรือจัดอันดับรายชื่ออาหารที่ผู้ให้บริการเสนอ
async function verifyFoodWithVision(candidates, languageCode, imageBuffer, mimeType) {
    const names = candidates.map((candidate) =>
        `${candidate.name} (${Math.round(candidate.score * 100)}%)`,
    ).join(', ');
    return generateGeminiJsonWithSearch({
        systemPrompt:
            `Independently identify the visible Thai dish. ${responseLanguageInstruction(languageCode)} ` +
            'Use Google Search results to verify the dish identity, its region, and typical ingredients before answering. ' +
            'Treat classifier candidates as weak hints, not facts. Keep thaiName in Thai and englishName in English. ' +
            'If the dish cannot be identified confidently, keep cultural and ingredient fields brief and do not invent history. ' +
            'In dietaryCaution, mention only potential allergens supported by what is visible or a typical recipe, ' +
            'state that recipes vary by vendor, and never guarantee exact ingredients, allergens, or halal status. ' +
            'Never claim rice noodles contain gluten; mention possible gluten only for sauces or wheat-based ingredients.',
        userPrompt:
            `Inspect the image yourself and identify the dish. Weak T-Food suggestions: ${names}. ` +
            'Return your own confidence based on the image.',
        schema: FOOD_SCHEMA,
        imageBuffer,
        mimeType,
    });
}

// สร้างผลลัพธ์มาตรฐานเมื่อระบบระบุอาหารได้ไม่มั่นใจ
const uncertainFoodResult = ({ copy, candidates, confidence, provider, languageCode }) => {
    const analysis = buildAnalysis({
        mode: 'food',
        title: copy.foodUncertainTitle,
        subtitle: copy.foodUncertainSubtitle,
        confidence,
        candidates,
        provider,
    });
    return {
        analysis,
        answer: analysisToAnswer(analysis, languageCode),
        sourceChunkIds: [],
    };
};

// วิเคราะห์อาหารจากหลายผู้ให้บริการและคืนผลที่มั่นใจที่สุด
async function analyzeFood({ imageBuffer, mimeType, languageCode }) {
    const copy = imageCopyFor(languageCode);
    let candidates = [];
    let result;
    let provider = 'aiforthai+gemini';
    try {
        candidates = await classifyThaiFood(imageBuffer);
        const tFoodConfidence = candidates[0].score;
        if (tFoodConfidence >= FOOD_VISION_VERIFY_THRESHOLD) {
            result = await explainFoodCandidate(
                candidates,
                languageCode,
                imageBuffer,
                mimeType,
            );
            const visionName = String(result.thaiName || '').trim().toLowerCase();
            const tFoodName = candidates[0].name.trim().toLowerCase();
            if (visionName === tFoodName) {
                result.confidence = tFoodConfidence;
                result.thaiName = candidates[0].name;
            } else {
                // แม้ T-Food คะแนนสูง แต่ถ้า vision เห็นต่าง ให้ใช้ผลที่เห็นภาพจริง
                // และงดเรื่องราวหาก vision เองยังไม่มั่นใจ
                provider = 'aiforthai+gemini_verification';
                candidates = mergeFoodCandidates(result, candidates);
                if (clampConfidence(result.confidence) < FOOD_VISION_VERIFY_THRESHOLD) {
                    return uncertainFoodResult({
                        copy,
                        candidates,
                        confidence: result.confidence,
                        provider,
                        languageCode,
                    });
                }
            }
        } else {
            // คะแนนต่ำต้องให้ vision model เห็นภาพและตัดสินใหม่เอง
            provider = 'aiforthai+gemini_verification';
            result = await verifyFoodWithVision(
                candidates,
                languageCode,
                imageBuffer,
                mimeType,
            );
            candidates = mergeFoodCandidates(result, candidates);

            if (clampConfidence(result.confidence) < FOOD_VISION_VERIFY_THRESHOLD) {
                return uncertainFoodResult({
                    copy,
                    candidates,
                    confidence: result.confidence,
                    provider,
                    languageCode,
                });
            }
        }
    } catch (primaryError) {
        // หาก T-Food ไม่มีผลลัพธ์ ให้ vision model วิเคราะห์แทนและลดความแน่นอนตามผลจริง
        console.warn('[image-analysis] T-Food flow failed:', primaryError.message);
        provider = 'gemini_fallback';
        result = await generateGeminiJsonWithSearch({
            systemPrompt:
                `Identify Thai food carefully. ${responseLanguageInstruction(languageCode)} ` +
                'Use Google Search results to verify the dish name, region, typical ingredients, and cultural context ' +
                'so the explanation is accurate rather than from memory alone. ' +
                'Keep thaiName in Thai and englishName in English. ' +
                'Mention only potential allergens supported by what is visible or a typical recipe, explicitly state ' +
                'that recipes vary by vendor, and never guarantee allergens, halal status, or exact ingredients from appearance alone. ' +
                'Never claim rice noodles contain gluten; mention possible gluten only for sauces or wheat-based ingredients.',
            userPrompt: 'Identify this dish and explain its cultural context, typical ingredients, and how it is served.',
            schema: FOOD_SCHEMA,
            imageBuffer,
            mimeType,
        });
        candidates = [{ name: result.thaiName, score: clampConfidence(result.confidence) }];
    }

    // เมื่อยืนยันชื่อได้แล้ว ไม่แสดงตัวเลือกอ่อนมากที่มีคะแนนต่ำกว่า 50% ให้ผู้ใช้สับสน
    candidates = candidates.filter((candidate, index) =>
        index === 0 || candidate.score >= FOOD_PLAUSIBLE_CANDIDATE_THRESHOLD,
    );

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

// เลือกกระบวนการวิเคราะห์ภาพตามโหมด place, sign หรือ food
async function analyzeTravelImage({
    mode,
    imageBuffer,
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
