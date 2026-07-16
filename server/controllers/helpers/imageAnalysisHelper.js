const { config } = require('../../config/env');
const {
    retrieveNearbyPlaces,
    formatPlacesContext,
} = require('./ragHelper');

const SCAN_MODES = new Set(['place', 'sign', 'food']);

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

    const url = `${config.gemini.apiBaseUrl}/models/${config.gemini.model}:generateContent?key=${config.gemini.apiKey}`;
    let lastError;

    for (let attempt = 0; attempt <= config.gemini.maxRetries; attempt++) {
        try {
            const response = await requestWithTimeout(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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

const analysisToAnswer = (analysis) => {
    const lines = [analysis.title];
    if (analysis.subtitle) lines.push(analysis.subtitle);
    if (analysis.originalText) {
        lines.push(`Original Thai\n${analysis.originalText}`);
    }
    if (analysis.translatedText) {
        lines.push(`English translation\n${analysis.translatedText}`);
    }
    for (const section of analysis.sections) {
        lines.push(`${section.title}\n${section.body}`);
    }
    if (analysis.candidates.length > 1) {
        lines.push(
            `Other possibilities\n${analysis.candidates
                .slice(1, 3)
                .map((candidate) => `${candidate.name} (${Math.round(candidate.score * 100)}%)`)
                .join(', ')}`,
        );
    }
    if (analysis.confidence < 0.8) {
        lines.push('The identification is uncertain. Try a clearer, closer photo or choose one of the alternatives.');
    }
    return lines.filter(Boolean).join('\n\n');
};

const extractOcrText = (value) => {
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) {
        return value.map(extractOcrText).filter(Boolean).join('\n').trim();
    }
    if (!value || typeof value !== 'object') return '';
    for (const key of ['text', 'result', 'recognized_text', 'ocr_text', 'message']) {
        const text = extractOcrText(value[key]);
        if (text) return text;
    }
    return '';
};

async function recognizeText(imageBuffer, mimeType) {
    if (!config.aiForThai.ocrApiKey) {
        throw new ImageAnalysisError('OCR key is missing', 'Thai OCR is not configured.', 503);
    }
    if (mimeType !== 'image/jpeg') {
        throw new ImageAnalysisError(
            `OCR does not accept ${mimeType}`,
            'Thai OCR currently requires a JPEG photo.',
            400,
        );
    }

    const form = new FormData();
    form.append('file', new Blob([imageBuffer], { type: mimeType }), 'scan.jpg');
    const response = await requestWithTimeout(config.aiForThai.ocrUrl, {
        method: 'POST',
        headers: { Apikey: config.aiForThai.ocrApiKey },
        body: form,
    }, 'Thai OCR');
    const raw = await response.text();
    let payload = raw;
    try {
        payload = JSON.parse(raw);
    } catch (_) {}
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

async function analyzePlace({ imageBuffer, mimeType, latitude, longitude }) {
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
            'You are a careful Thai cultural guide. Answer in clear English for international visitors. ' +
            'Do not claim an exact landmark unless visual evidence and the nearby destination context support it. ' +
            'When uncertain, describe what is visible and say what additional photo would help.',
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
            { title: 'What you are seeing', body: result.summary },
            { title: 'Cultural significance', body: result.culturalSignificance },
            { title: 'Visitor etiquette', body: result.visitorEtiquette },
        ],
    });
    return {
        analysis,
        answer: analysisToAnswer(analysis),
        sourceChunkIds: matched ? [matched.id] : [],
    };
}

async function analyzeSign({ imageBuffer, mimeType }) {
    try {
        const originalText = await recognizeText(imageBuffer, mimeType);
        const translatedText = await translateThaiText(originalText);
        const analysis = buildAnalysis({
            mode: 'sign',
            title: 'Thai sign translation',
            confidence: 1,
            provider: 'aiforthai',
            originalText,
            translatedText,
        });
        return { analysis, answer: analysisToAnswer(analysis), sourceChunkIds: [] };
    } catch (primaryError) {
        console.warn('[image-analysis] AI for Thai sign flow failed:', primaryError.message);
        const result = await generateGeminiJson({
            systemPrompt:
                'Read Thai text from travel signs and translate it into natural English. ' +
                'Preserve place names and line breaks where useful. Do not invent unreadable text.',
            userPrompt: 'Extract the visible Thai text and translate it to English.',
            schema: SIGN_SCHEMA,
            imageBuffer,
            mimeType,
        });
        const analysis = buildAnalysis({
            mode: 'sign',
            title: 'Thai sign translation',
            confidence: result.confidence,
            provider: 'gemini_fallback',
            originalText: result.originalText,
            translatedText: result.translatedText,
        });
        return { analysis, answer: analysisToAnswer(analysis), sourceChunkIds: [] };
    }
}

async function explainFoodCandidate(candidates) {
    const names = candidates.map((candidate) =>
        `${candidate.name} (${Math.round(candidate.score * 100)}%)`,
    ).join(', ');
    return generateGeminiJson({
        systemPrompt:
            'You are a careful Thai food and culture guide. Answer in concise, natural English. ' +
            'Describe common ingredients only; never guarantee allergens, halal status, or exact recipe from an image.',
        userPrompt:
            `T-Food returned these possible dishes: ${names}. Explain the top candidate for an international visitor, ` +
            'while reflecting uncertainty when its score is below 0.8.',
        schema: FOOD_SCHEMA,
    });
}

async function analyzeFood({ imageBuffer, mimeType }) {
    let candidates = [];
    let result;
    let provider = 'aiforthai+gemini';
    try {
        candidates = await classifyThaiFood(imageBuffer);
        result = await explainFoodCandidate(candidates);
        result.confidence = candidates[0].score;
        result.thaiName = candidates[0].name;
    } catch (primaryError) {
        console.warn('[image-analysis] T-Food flow failed:', primaryError.message);
        provider = 'gemini_fallback';
        result = await generateGeminiJson({
            systemPrompt:
                'Identify Thai food carefully and explain it in concise English for international visitors. ' +
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
            { title: 'About this dish', body: result.summary },
            { title: 'Cultural context', body: result.culturalSignificance },
            { title: 'Typical ingredients', body: result.typicalIngredients },
            { title: 'How it is served', body: result.servingNotes },
            { title: 'Dietary note', body: result.dietaryCaution },
        ],
    });
    return { analysis, answer: analysisToAnswer(analysis), sourceChunkIds: [] };
}

async function analyzeTravelImage({
    mode,
    imageBuffer,
    mimeType,
    latitude,
    longitude,
}) {
    if (!SCAN_MODES.has(mode)) {
        throw new ImageAnalysisError('Unsupported scan mode', 'Please choose place, sign, or food.', 400);
    }
    if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
        throw new ImageAnalysisError('Image is empty', 'Please choose a photo to analyze.', 400);
    }
    const detectedMimeType = detectImageMimeType(imageBuffer);
    if (!detectedMimeType) {
        throw new ImageAnalysisError(
            'Image signature is invalid',
            'The uploaded file is not a supported JPEG, PNG, or WebP image.',
            400,
        );
    }

    if (mode === 'place') {
        return analyzePlace({
            imageBuffer,
            mimeType: detectedMimeType,
            latitude,
            longitude,
        });
    }
    if (mode === 'sign') {
        return analyzeSign({ imageBuffer, mimeType: detectedMimeType });
    }
    return analyzeFood({ imageBuffer, mimeType: detectedMimeType });
}

module.exports = {
    ImageAnalysisError,
    analysisToAnswer,
    analyzeTravelImage,
    detectImageMimeType,
    extractOcrText,
};
