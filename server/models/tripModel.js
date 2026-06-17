const { query } = require('../config/db');

class TripModel {
    static async create(data, userId) {
        const { rows } = await query(
            `INSERT INTO trips
                (user_id, destination, province, days, budget, currency,
                 travel_style, group_type, interests, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'generating')
             RETURNING id`,
            [
                userId,
                data.destination,
                data.province || null,
                data.days || 3,
                data.budget || null,
                data.currency || 'THB',
                data.travel_style || null,
                data.group_type || null,
                JSON.stringify(data.interests || []),
            ]
        );
        return rows[0].id;
    }

    static async getByUserId(userId) {
        const { rows } = await query(
            `SELECT t.id, t.destination, t.province, t.days, t.budget,
                    t.travel_style, t.group_type, t.status, t.created_at,
                    tp.plan_data
             FROM trips t
             LEFT JOIN trip_plans tp ON tp.trip_id = t.id
             WHERE t.user_id = $1
             ORDER BY t.created_at DESC
             LIMIT 20`,
            [userId]
        );
        return rows;
    }

    static async getById(id) {
        const { rows } = await query(
            `SELECT t.*, tp.plan_data, tp.markdown_cache, tp.generated_at
             FROM trips t
             LEFT JOIN trip_plans tp ON tp.trip_id = t.id
             WHERE t.id = $1`,
            [id]
        );
        return rows[0] || null;
    }
}

module.exports = TripModel;