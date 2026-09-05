// server/controllers/helpers/webSearchHelper.js
// แทน Gemini Google Search grounding (ต้องเปิด billing) ด้วยการค้นเว็บเองข้างนอก
// แล้วเอาข้อความยัดเข้า Gemini prompt — ใช้ Gemini Free Tier เดิมได้เลย
//
// ลำดับ provider: Tavily (หลัก, ใช้ TAVILY_API_KEY ของโปรเจกต์) → Wikipedia th/en + DuckDuckGo
// (fallback ฟรี ไม่ต้องใช้ key, กันตอน Tavily โควต้าหมด/ล่ม)
// ประหยัดเครดิต: DB-first (เรียกเฉพาะตอน DB ว่าง), cache 10 นาที, 1 call ต่อ 1 เทิร์น,
// search_depth=basic (1 credit) ห้ามใช้ advanced (2 credits)

const { config } = require('../../config/env');

const TAVILY_API_URL = 'https://api.tavily.com/search';
const DDG_API_URL = 'https://api.duckduckgo.com/';
const WIKI_TH_API_URL = 'https://th.wikipedia.org/w/api.php';
const WIKI_EN_API_URL = 'https://en.wikipedia.org/w/api.php';

// cache ใน memory กันยิง Tavily ซ้ำคำถามเดิม (ประหยัด credit)
const searchCache = new Map(); // key -> { expiresAt, results }
const MAX_CACHE_ENTRIES = 200;

const stripHtml = (value) => String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeUri = (uri) => String(uri || '').trim().replace(/\/+$/, '').toLowerCase();

const getCache = (key) => {
    const entry = searchCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        searchCache.delete(key);
        return null;
    }
    return entry.results;
};

const setCache = (key, results) => {
    if (searchCache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = searchCache.keys().next().value;
        searchCache.delete(oldestKey);
    }
    searchCache.set(key, {
        expiresAt: Date.now() + Math.max(0, config.webSearch.cacheTtlMs),
        results,
    });
};

const fetchWithTimeout = async (url, options = {}, timeoutMs) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
};

// --- Tavily (ตัวหลัก, เสีย 1 credit/call ด้วย search_depth=basic) ---
const searchTavily = async (queryText, limit, timeoutMs) => {
    const apiKey = config.webSearch.tavilyApiKey;
    if (!apiKey) return [];
    const response = await fetchWithTimeout(TAVILY_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            // ส่ง key ใน header เท่านั้น ห้ามติด URL/log
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            query: queryText,
            search_depth: config.webSearch.tavilySearchDepth || 'basic',
            max_results: limit,
            chunks_per_source: 1,
            topic: 'general',
            include_answer: false,
            include_raw_content: false,
        }),
    }, timeoutMs);
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        if (response.status === 401 || response.status === 403) {
            console.warn(`[websearch] tavily auth failed (${response.status}); check TAVILY_API_KEY`);
        } else if (response.status === 429) {
            console.warn('[websearch] tavily quota/rate limited (429); falling back to free providers');
        } else {
            console.warn(`[websearch] tavily HTTP ${response.status}: ${body.slice(0, 200)}`);
        }
        return [];
    }
    const payload = await response.json().catch(() => null);
    const items = Array.isArray(payload?.results) ? payload.results : [];
    return items
        .map((item) => ({
            title: stripHtml(item?.title).slice(0, 200),
            snippet: stripHtml(item?.content).slice(0, 500),
            uri: String(item?.url || '').trim(),
        }))
        .filter((item) => item.uri && item.snippet);
};

// --- Wikipedia (fallback ฟรี ไม่ต้องใช้ key) ---
const searchWikipedia = async (apiUrl, queryText, limit, timeoutMs) => {
    const params = new URLSearchParams({
        action: 'query',
        list: 'search',
        srsearch: queryText,
        srlimit: String(limit),
        format: 'json',
    });
    const response = await fetchWithTimeout(`${apiUrl}?${params.toString()}`, {
        headers: { 'User-Agent': 'smarttravel-websearch/1.0' },
    }, timeoutMs);
    if (!response.ok) return [];
    const payload = await response.json().catch(() => null);
    const items = payload?.query?.search || [];
    const origin = apiUrl.replace('/w/api.php', '');
    return items.map((item) => ({
        title: stripHtml(item?.title).slice(0, 200),
        snippet: stripHtml(item?.snippet).slice(0, 500),
        uri: `${origin}/wiki/${encodeURIComponent(String(item?.title || '').replace(/ /g, '_'))}`,
    })).filter((item) => item.snippet);
};

// --- DuckDuckGo Instant Answer (fallback ฟรี ไม่ต้องใช้ key) ---
const searchDuckDuckGo = async (queryText, timeoutMs) => {
    const params = new URLSearchParams({
        q: queryText,
        format: 'json',
        no_html: '1',
        skip_disambig: '1',
    });
    const response = await fetchWithTimeout(`${DDG_API_URL}?${params.toString()}`, {
        headers: { 'User-Agent': 'smarttravel-websearch/1.0' },
    }, timeoutMs);
    if (!response.ok) return [];
    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload !== 'object') return [];
    const results = [];
    if (payload.AbstractText && payload.AbstractURL) {
        results.push({
            title: stripHtml(payload.Heading || payload.AbstractSource).slice(0, 200) || 'DuckDuckGo',
            snippet: stripHtml(payload.AbstractText).slice(0, 500),
            uri: String(payload.AbstractURL).trim(),
        });
    }
    for (const topic of payload.RelatedTopics || []) {
        if (results.length >= 3) break;
        const node = topic?.FirstURL ? topic : topic?.Topics?.[0];
        if (node?.FirstURL && node?.Text) {
            results.push({
                title: stripHtml(node.Text.split(' - ')[0]).slice(0, 200) || 'DuckDuckGo',
                snippet: stripHtml(node.Text).slice(0, 500),
                uri: String(node.FirstURL).trim(),
            });
        }
    }
    return results;
};

// ค้นเว็บแบบ hybrid: Tavily ก่อน, ถ้าได้น้อยกว่า 2 ผลค่อยเติมด้วยของฟรี
// คืน [] แทน throw เสมอ เพื่อให้ caller ตอบแบบไม่มีเว็บได้ ไม่ล่ม
async function freeWebSearch(queryText, { limit = null } = {}) {
    if (!config.webSearch.enabled) return [];
    const normalized = String(queryText || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!normalized) return [];
    const maxResults = Math.min(
        10,
        Math.max(1, limit || config.webSearch.maxResults),
    );
    const cacheKey = normalized.toLowerCase();
    const cached = getCache(cacheKey);
    if (cached) return cached.slice(0, maxResults);

    const timeoutMs = config.webSearch.timeoutMs;
    const providers = new Set(config.webSearch.providers);

    let results = [];
    if (providers.has('tavily')) {
        try {
            results = await searchTavily(normalized, maxResults, timeoutMs);
        } catch (error) {
            console.warn(`[websearch] tavily failed: ${error?.name === 'AbortError' ? 'timed out' : error.message}`);
            results = [];
        }
    }

    // ได้ไม่พอ → เติมด้วยของฟรี (ขนานกัน, ตัวไหนล่มก็ข้าม)
    if (results.length < Math.min(2, maxResults)) {
        const freeTasks = [];
        if (providers.has('wikipedia')) {
            freeTasks.push(
                searchWikipedia(WIKI_TH_API_URL, normalized, 3, timeoutMs)
                    .catch(() => []),
                searchWikipedia(WIKI_EN_API_URL, normalized, 2, timeoutMs)
                    .catch(() => []),
            );
        }
        if (providers.has('duckduckgo')) {
            freeTasks.push(searchDuckDuckGo(normalized, timeoutMs).catch(() => []));
        }
        if (freeTasks.length > 0) {
            const settled = await Promise.all(freeTasks);
            results = [...results, ...settled.flat()];
        }
    }

    const seen = new Set();
    const deduped = [];
    for (const item of results) {
        const key = normalizeUri(item.uri);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        deduped.push(item);
        if (deduped.length >= maxResults) break;
    }

    setCache(cacheKey, deduped);
    return deduped;
}

// แปลงผล search เป็น context ข้อความยัดเข้า Gemini prompt
const formatWebSearchContext = (results) => {
    if (!results.length) return '';
    return results.map((item, i) =>
        `[W${i + 1}] ${item.title}\n${item.snippet}\nURL: ${item.uri}`,
    ).join('\n\n');
};

// adapter ให้ formatWebCitations() เดิมใน aiHelper ใช้ต่อได้โดยไม่แก้
const toGroundingChunks = (results) => results.map((item) => ({
    web: { title: item.title, uri: item.uri },
}));

module.exports = { freeWebSearch, formatWebSearchContext, toGroundingChunks };
