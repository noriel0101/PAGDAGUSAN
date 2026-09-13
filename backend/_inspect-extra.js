const p = require("pg");
const pool = new p.Pool({
  host: "localhost",
  port: 5432,
  database: "PAGDAGUSAN_V2",
  user: "postgres",
  password: "070105",
});
(async () => {
  const fk = await pool.query(
    "SELECT kcu.column_name, ccu.table_name AS foreign_table, ccu.column_name AS foreign_column FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_name='payments' JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name WHERE tc.table_name='payments' AND tc.constraint_type='FOREIGN KEY'"
  );
  console.log("FK:", JSON.stringify(fk.rows));
  const cc = await pool.query(
    "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='payments'::regclass AND contype='c'"
  );
  console.log("CHECKS:", JSON.stringify(cc.rows));
  const ll = await pool.query(
    "SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_name='leases' ORDER BY ordinal_position"
  );
  console.log("LEASES:", JSON.stringify(ll.rows));
  const lc = await pool.query(
    "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='leases'::regclass AND contype='c'"
  );
  console.log("LEASE CHECKS:", JSON.stringify(lc.rows));
  const tv = await pool.query("SELECT viewname FROM pg_views WHERE schemaname='public'");
  console.log("VIEWS:", JSON.stringify(tv.rows));
  await pool.end();
})();