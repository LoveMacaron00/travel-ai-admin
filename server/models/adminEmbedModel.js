const pool = require('../config/db');

class AdminEmbedModel {
    static async approvePlace(placeId, adminId) {
        const { rows } = await pool.query(
            `UPDATE destinations
             SET status = 'approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
             WHERE id = $2 AND status = 'pending'
             RETURNING id, name`,
            [adminId, placeId]
        );
        return rows[0] || null;
    }

    static async rejectPlace(placeId) {
        const { rows } = await pool.query(
            `UPDATE destinations
             SET status = 'rejected', updated_at = NOW()
             WHERE id = $1 AND status = 'pending'
             RETURNING id, name`,
            [placeId]
        );
        return rows[0] || null;
    }
}

module.exports = AdminEmbedModel;
