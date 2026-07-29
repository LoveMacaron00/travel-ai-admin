const { config } = require('./env');

const WEAK_SECRETS = new Set([
    'dev-admin-secret',
    'dev-user-secret',
    'change_this_admin_secret_min_32_chars',
    'change_this_user_secret_min_32_chars',
    'change_this_secret_min_32_chars',
    'secret',
    '123456',
]);

/**
 * ตรวจ JWT secret ตอนเริ่ม process เพียงจุดเดียว
 * ระบบใช้งานจริงจะหยุดทันทีเมื่อเกิดข้อผิดพลาด ส่วนระบบพัฒนาใช้ค่าทดแทนเพื่อให้เริ่มระบบได้
 * แต่จะแจ้งเตือนชัดเจนว่าไม่ควรนำค่าทดแทนไปเผยแพร่ใช้งาน
 */
const resolveJwtSecret = ({ environmentName, configuredValue, developmentFallback }) => {
    let value = configuredValue;
    if (!value) {
        if (config.nodeEnv === 'production') {
            throw new Error(`CRITICAL SECURITY ERROR: ${environmentName} is not configured in production.`);
        }
        console.warn(`[WARNING] ${environmentName} is not configured. Using a development-only fallback.`);
        value = developmentFallback;
    } else if (WEAK_SECRETS.has(value.toLowerCase()) || value.length < 32) {
        if (config.nodeEnv === 'production') {
            throw new Error(`CRITICAL SECURITY ERROR: ${environmentName} must contain at least 32 strong characters.`);
        }
        console.warn(`[WARNING] ${environmentName} is weak. Use at least 32 strong characters before deployment.`);
    }
    return value;
};

const adminJwtSecret = resolveJwtSecret({
    environmentName: 'ADMIN_JWT_SECRET',
    configuredValue: config.jwt.adminSecret,
    developmentFallback: 'dev-admin-secret-fallback-key-32chars-min-length-required',
});

const userJwtSecret = resolveJwtSecret({
    environmentName: 'USER_JWT_SECRET',
    configuredValue: config.jwt.userSecret,
    developmentFallback: 'dev-user-secret-fallback-key-32chars-min-length-required',
});

module.exports = { adminJwtSecret, userJwtSecret };
