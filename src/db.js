'use strict';

const sql = require('mssql');
const config = require('./config');

let poolPromise = null;
let activePool = null;

function createPool() {
  const pool = new sql.ConnectionPool({
    server: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    connectionTimeout: config.db.connectionTimeoutMs,
    requestTimeout: config.db.requestTimeoutMs,
    options: {
      encrypt: config.db.encrypt,
      trustServerCertificate: config.db.trustServerCertificate,
      enableArithAbort: true,
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  });

  pool.on('error', (error) => {
    console.error('[db] pool error:', error.message);
  });

  return pool;
}

async function getPool() {
  if (!poolPromise) {
    activePool = createPool();
    poolPromise = activePool.connect().catch((error) => {
      poolPromise = null;
      activePool = null;
      throw error;
    });
  }
  return poolPromise;
}

/**
 * Menjalankan query dengan parameter bernama.
 * Nilai string selalu dikirim sebagai NVarChar, angka sebagai Int.
 */
async function query(text, params = {}) {
  const pool = await getPool();
  const request = pool.request();

  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      request.input(name, sql.NVarChar, null);
    } else if (typeof value === 'number' && Number.isInteger(value)) {
      request.input(name, sql.Int, value);
    } else {
      request.input(name, sql.NVarChar, String(value));
    }
  }

  const result = await request.query(text);
  return result.recordset || [];
}

async function close() {
  if (!poolPromise) return;

  const pool = await poolPromise.catch(() => null);
  poolPromise = null;
  activePool = null;

  if (pool) await pool.close();
}

async function ping() {
  const rows = await query('SELECT 1 AS ok');
  return rows[0]?.ok === 1;
}

module.exports = {
  sql,
  getPool,
  query,
  close,
  ping,
  get activePool() {
    return activePool;
  },
};
