const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function initDatabase() {
  const client = await pool.connect();
  try {
    const initSQL = fs.readFileSync(path.join(__dirname, '..', 'db', 'init.sql'), 'utf8');
    await client.query(initSQL);

    // Seed superadmin if not exists
    const { rows } = await client.query("SELECT id FROM users WHERE username = 'admin'");
    if (rows.length === 0) {
      const hash = await bcrypt.hash('abcd1234', 10);
      await client.query(
        "INSERT INTO users (username, password_hash, full_name, role) VALUES ($1, $2, $3, $4)",
        ['admin', hash, 'Super Admin', 'superadmin']
      );
      console.log('✅ Superadmin dibuat (admin / abcd1234)');
    }

    console.log('✅ Database siap');
  } catch (err) {
    console.error('❌ Database init error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, initDatabase };
