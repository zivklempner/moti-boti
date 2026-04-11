const { Pool } = require("pg");

let _pool = null;

function getPool() {
  if (!_pool) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // required for Neon / Railway Postgres
      max: 10,
      idleTimeoutMillis: 30000,
    });
    _pool.on("error", (err) => console.error("Postgres pool error:", err.message));
  }
  return _pool;
}

async function query(sql, params = []) {
  return getPool().query(sql, params);
}

/**
 * Run schema.sql once at startup to ensure tables exist.
 */
async function initDb() {
  const fs = require("fs");
  const path = require("path");
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  try {
    await query(schema);
    console.log("Postgres schema ready ✓");
  } catch (err) {
    console.error("Postgres schema init failed:", err.message);
  }
}

module.exports = { getPool, query, initDb };
