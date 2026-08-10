const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { config } = require('../config/env');

const resolveAllowedMediaUrl = (rawUrl, allowedHosts = config.mediaProxy.allowedHosts) => {
    const target = new URL(String(rawUrl || '').trim());
    if (target.protocol !== 'https:' || !allowedHosts.includes(target.hostname)) {
        throw new Error('Media URL is not allowed');
    }
    if (target.username || target.password) throw new Error('Media URL is not allowed');
    return target;
};

const proxyImage = async (req, res) => {
    let target;
    try {
        target = resolveAllowedMediaUrl(req.query.url);
    } catch {
        return res.status(400).json({ message: 'URL รูปภาพไม่ได้รับอนุญาต' });
    }

    try {
        const upstream = await fetch(target, {
            redirect: 'error',
            signal: AbortSignal.timeout(config.mediaProxy.timeoutMs),
            headers: {
                Accept: 'image/avif,image/webp,image/*',
                'Accept-Encoding': 'identity',
                'User-Agent': 'GoThai-Media-Proxy/1.0',
            },
        });
        if (!upstream.ok || !upstream.body) {
            return res.status(502).json({ message: 'ไม่สามารถโหลดรูปภาพต้นทางได้' });
        }

        const contentType = String(upstream.headers.get('content-type') || '')
            .split(';', 1)[0]
            .trim()
            .toLowerCase();
        if (!contentType.startsWith('image/')) {
            return res.status(415).json({ message: 'ปลายทางไม่ได้ส่งข้อมูลรูปภาพ' });
        }

        const declaredLength = Number(upstream.headers.get('content-length'));
        if (Number.isFinite(declaredLength) && declaredLength > config.mediaProxy.maxBytes) {
            return res.status(413).json({ message: 'รูปภาพต้นทางมีขนาดใหญ่เกินไป' });
        }

        let receivedBytes = 0;
        const sizeLimiter = new Transform({
            transform(chunk, _encoding, callback) {
                receivedBytes += chunk.length;
                if (receivedBytes > config.mediaProxy.maxBytes) {
                    callback(new Error('Remote image exceeds the configured size limit'));
                    return;
                }
                callback(null, chunk);
            },
        });

        res.status(200);
        res.set({
            'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
            'Content-Type': contentType,
            'Cross-Origin-Resource-Policy': 'same-site',
            'X-Content-Type-Options': 'nosniff',
        });
        await pipeline(Readable.fromWeb(upstream.body), sizeLimiter, res);
    } catch (error) {
        if (res.headersSent) {
            res.destroy(error);
            return;
        }
        res.status(502).json({ message: 'ไม่สามารถโหลดรูปภาพต้นทางได้' });
    }
};

module.exports = { proxyImage };
