const pool = require("./db");
(async () => {
  const v = await pool.query(
    "SELECT view_definition FROM information_schema.views WHERE table_name = 'tenant_current_room'"
  );
  console.log("VIEW tenant_current_room:", v.rows[0]?.view_definition);
  const t = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name NOT LIKE 'pg_%'");
  console.log("TABLES:", JSON.stringify(t.rows));
  const pay = await pool.query("SELECT COUNT(*)::int AS n FROM payments");
  console.log("payment rows:", pay.rows[0].n);
  const le = await pool.query("SELECT id, tenant_id, room_id, status FROM leases ORDER BY created_at DESC LIMIT 10");
  console.log("leases:", JSON.stringify(le.rows));
  const us = await pool.query("SELECT id, name, email, role, status FROM users ORDER BY created_at DESC LIMIT 15");
  console.log("recent users:", JSON.stringify(us.rows));
  await pool.end();
})();