require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
(async () => {
  try { await pool.query(fs.readFileSync('./schema.sql', 'utf8')); console.log('Database initialised'); }
  finally { await pool.end(); }
})().catch(e => { console.error(e); process.exit(1); });
