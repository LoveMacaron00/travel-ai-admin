const { query } = require('../config/db');

class AdminModel {
    static async getByEmail(email) {
        const { rows } = await query('SELECT id, email, password FROM admins WHERE email = $1 LIMIT 1', [email]);
        return rows[0] || null;
    }
}

module.exports = AdminModel;