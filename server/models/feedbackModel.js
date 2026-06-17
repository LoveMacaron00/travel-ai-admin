const { query } = require('../config/db');

class FeedbackModel {
    static async getAll() {
        const { rows } = await query(
            `SELECT f.id, f.message, f.status, f.admin_reply, f.created_at,
                    u.username, u.email AS user_email
             FROM feedback f
             LEFT JOIN users u ON f.user_id = u.id
             ORDER BY f.created_at DESC`
        );
        return rows;
    }

    static async update(id, status, admin_reply) {
        const { rows } = await query(
            `UPDATE feedback
             SET status = $1, admin_reply = $2
             WHERE id = $3
             RETURNING id, user_id, message, status, admin_reply, created_at`,
            [status, admin_reply, id]
        );
        return rows[0] || null;
    }
}

module.exports = FeedbackModel;