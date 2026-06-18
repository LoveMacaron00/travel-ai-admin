const pool = require('../config/db');
const bcrypt = require('bcryptjs');

const PUBLIC_COLUMNS = 'id, email, username, profile_image_url, interests, is_private_location, is_banned, created_at';

class UserModel {
    static async getAll() {
        const { rows } = await pool.query(
            `SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY created_at DESC`
        );
        return rows;
    }

    static async getById(id) {
        const { rows } = await pool.query(
            `SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`,
            [id]
        );
        return rows[0] || null;
    }

    static async getByEmail(email, includePassword = false) {
        const columns = includePassword ? `${PUBLIC_COLUMNS}, hash_password` : PUBLIC_COLUMNS;
        const { rows } = await pool.query(
            `SELECT ${columns} FROM users WHERE email = $1`,
            [email]
        );
        return rows[0] || null;
    }

    static async create(email, password) {
        const passwordHash = await bcrypt.hash(password, 10);
        const { rows } = await pool.query(
            `INSERT INTO users (email, hash_password, username)
             VALUES ($1, $2, $3)
             RETURNING ${PUBLIC_COLUMNS}`,
            [email, passwordHash, null]
        );
        return rows[0];
    }

    static async toggleBanStatus(id) {
        const { rows: userRows } = await pool.query(
            'SELECT is_banned FROM users WHERE id = $1',
            [id]
        );

        if (userRows.length === 0) {
            return null;
        }

        const newBanStatus = !userRows[0].is_banned;
        const { rows } = await pool.query(
            `UPDATE users SET is_banned = $1 WHERE id = $2
             RETURNING ${PUBLIC_COLUMNS}`,
            [newBanStatus, id]
        );
        return rows[0] || null;
    }

    static async updateProfile(id, updates) {
        const updateStrings = [];
        const values = [];
        let index = 1;

        if (updates.username !== undefined) {
            updateStrings.push(`username = $${index++}`);
            values.push(updates.username);
        }
        if (updates.interests !== undefined) {
            updateStrings.push(`interests = $${index++}`);
            values.push(JSON.stringify(Array.isArray(updates.interests) ? updates.interests : []));
        }
        if (updates.is_private_location !== undefined) {
            updateStrings.push(`is_private_location = $${index++}`);
            values.push(updates.is_private_location === true);
        }
        if (updates.profile_image_url !== undefined) {
            updateStrings.push(`profile_image_url = $${index++}`);
            values.push(updates.profile_image_url);
        }

        if (updateStrings.length === 0) {
            return null;
        }

        values.push(id);
        const { rows } = await pool.query(
            `UPDATE users 
             SET ${updateStrings.join(', ')} 
             WHERE id = $${index} 
             RETURNING ${PUBLIC_COLUMNS}`,
            values
        );

        return rows[0] || null;
    }

    static async updateProfileImage(id, imageUrl) {
        const { rows } = await pool.query(
            `UPDATE users SET profile_image_url = $1 WHERE id = $2 RETURNING ${PUBLIC_COLUMNS}`,
            [imageUrl, id]
        );
        return rows[0] || null;
    }
}

module.exports = UserModel;
