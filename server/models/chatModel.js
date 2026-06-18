const pool = require('../config/db');

class ChatModel {
    static async getTripById(tripId) {
        const { rows } = await pool.query('SELECT id FROM trips WHERE id = $1', [tripId]);
        return rows[0] || null;
    }

    static async createSession(tripId, userId) {
        const { rows } = await pool.query(
            `INSERT INTO chat_sessions (user_id, trip_id)
             VALUES ($1, $2) RETURNING id, created_at`,
            [userId, tripId]
        );
        return rows[0];
    }

    static async getSessionById(sessionId) {
        const { rows } = await pool.query(
            'SELECT id, trip_id FROM chat_sessions WHERE id = $1',
            [sessionId]
        );
        return rows[0] || null;
    }

    static async getHistoryMessages(sessionId, limit = 10) {
        const { rows } = await pool.query(
            `SELECT role, content FROM chat_messages
             WHERE session_id = $1
             ORDER BY created_at DESC
             LIMIT $2`,
            [sessionId, limit]
        );
        return rows.reverse();
    }

    static async getMessagesBySession(sessionId) {
        const { rows } = await pool.query(
            `SELECT id, role, content, source_chunk_ids, created_at
             FROM chat_messages
             WHERE session_id = $1
             ORDER BY created_at ASC`,
            [sessionId]
        );
        return rows;
    }

    static async getSessionByTrip(tripId, userId) {
        const { rows } = await pool.query(
            `SELECT id, trip_id, created_at FROM chat_sessions
             WHERE trip_id = $1 AND ($2::int IS NULL OR user_id = $2)
             ORDER BY created_at DESC LIMIT 1`,
            [tripId, userId]
        );
        return rows[0] || null;
    }
}

module.exports = ChatModel;
