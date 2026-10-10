require('dotenv').config();
console.log(typeof process.env.DB_PASSWORD, JSON.stringify(process.env.DB_PASSWORD));
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD ?? ''),
});
(async () => {
  const tables = ['properties', 'rooms', 'users'];
  for (const t of tables) {
    const r = await pool.query(
      `SELECT column_name, data_type, udt_name, is_nullable
       FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
      [t]
    );
    console.log(`--- ${t} ---`);
    if (r.rows.length === 0) {
      console.log('TABLE NOT FOUND');
    } else {
      console.log(r.rows.map((c) => `${c.column_name} ${c.udt_name}${c.is_nullable === 'NO' ? ' NOT NULL' : ''}`).join(', '));
    }
  }
  try {
    const r2 = await pool.query(`SELECT to_regclass('public.property_photos') AS exists`);
    console.log('--- property_photos exists? ---', r2.rows[0].exists);
  } catch (e) {
    console.log('--- property_photos check error ---', e.message);
  }
  await pool.end();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});