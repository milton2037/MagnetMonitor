// ══════════════════════════════════════════════════════════════════
// db.js  –  Pool de conexiones MySQL2 con reconexión automática
// ══════════════════════════════════════════════════════════════════
'use strict';

require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || 'localhost',
  port:    parseInt(  process.env.DB_PORT     || '3306', 10),
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '',
  database:           process.env.DB_NAME     || 'magnetmonitor',
  waitForConnections: true,
  connectionLimit:    parseInt(process.env.DB_POOL_SIZE || '10', 10),
  queueLimit:         0,
  enableKeepAlive:    true,
  keepAliveInitialDelay: 0,
  timezone:           'Z',                   // UTC siempre
});

// Verificación inicial
(async () => {
  try {
    const conn = await pool.getConnection();
    console.log('[DB] ✅ Conectado a MySQL:', process.env.DB_NAME);
    conn.release();
  } catch (err) {
    console.error('[DB] ❌ Error de conexión:', err.message);
    console.error('     Revisa tu archivo .env y que MySQL esté corriendo.');
  }
})();

module.exports = pool;
