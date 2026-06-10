// cron/tatSyncCron.js — cron job sync TAT ทุกวัน 02:00 น.
const cron = require('node-cron');
const { syncAllTATPlaces } = require('../services/tatSyncService');

function startTATSyncCron() {
    // ทุกวัน เวลา 02:00 น.
    cron.schedule('0 2 * * *', async () => {
        console.log('[cron] TAT sync เริ่มทำงาน:', new Date().toISOString());
        try {
            const result = await syncAllTATPlaces();
            console.log('[cron] TAT sync เสร็จสิ้น:', result);
        } catch (err) {
            console.error('[cron] TAT sync error:', err.message);
        }
    }, { timezone: 'Asia/Bangkok' });

    console.log('[cron] TAT sync cron job ลงทะเบียนแล้ว (ทุกวัน 02:00 น.)');
}

module.exports = { startTATSyncCron };
