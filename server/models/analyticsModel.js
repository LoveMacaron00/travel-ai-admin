const pool = require('../config/db');

class AnalyticsModel {
    static async getTotalDestinations() {
        const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM destinations');
        return rows[0].total;
    }
}

module.exports = AnalyticsModel;
