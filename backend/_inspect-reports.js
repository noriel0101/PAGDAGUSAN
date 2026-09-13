require("dotenv").config();
const pool = require("C:/Users/Reyner Jade/Desktop/PAGDAGUSAN V2/backend/db");

(async () => {
  try {
    console.log("=== TABLES ===");
    const tables = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
    console.log(JSON.stringify(tables.rows.map(r => r.tablename)));

    console.log("\n=== VIEWS ===");
    const views = await pool.query(`SELECT viewname FROM pg_views WHERE schemaname='public' ORDER BY viewname`);
    console.log(JSON.stringify(views.rows.map(r => r.viewname)));

    console.log("\n=== ENUMS ===");
    const enums = await pool.query(
      `SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
       FROM pg_type t JOIN pg_enum e ON t.oid=e.enumtypid GROUP BY t.typname ORDER BY t.typname`);
    console.log(JSON.stringify(enums.rows, null, 2));

    for (const t of ["users","properties","rooms","leases","payments","maintenance_requests","announcements","messages","audit_logs"]) {
      console.log(`\n=== COLUMNS ${t} ===`);
      const cols = await pool.query(
        `SELECT column_name, data_type, udt_name, column_default, is_nullable
         FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`, [t]);
      console.table(cols.rows);
    }

    console.log("\n=== DATA COUNTS ===");
    for (const t of ["users","properties","rooms","leases","payments","maintenance_requests","announcements","messages","audit_logs"]) {
      const r = await pool.query(`SELECT COUNT(*)::int AS c FROM ${t}`);
      console.log(t, r.rows[0].c);
    }

    console.log("\n=== USERS BY ROLE/STATUS ===");
    const ur = await pool.query(`SELECT role, status, COUNT(*)::int AS c FROM users GROUP BY role, status ORDER BY role, status`);
    console.table(ur.rows);

    console.log("\n=== ROOMS BY STATUS ===");
    const rr = await pool.query(`SELECT status, COUNT(*)::int AS c FROM rooms GROUP BY status ORDER BY status`);
    console.table(rr.rows);

    console.log("\n=== LEASES BY STATUS ===");
    const lr = await pool.query(`SELECT status, COUNT(*)::int AS c FROM leases GROUP BY status ORDER BY status`);
    console.table(lr.rows);

    console.log("\n=== PAYMENTS BY STATUS ===");
    const pr = await pool.query(`SELECT status, COUNT(*)::int AS c FROM payments GROUP BY status ORDER BY status`);
    console.table(pr.rows);

    console.log("\n=== MAINTENANCE BY STATUS/PRIORITY ===");
    const mr = await pool.query(`SELECT status, COUNT(*)::int AS c FROM maintenance_requests GROUP BY status ORDER BY status`);
    console.table(mr.rows);
    const mp = await pool.query(`SELECT priority, COUNT(*)::int AS c FROM maintenance_requests GROUP BY priority ORDER BY priority`);
    console.table(mp.rows);

    console.log("\n=== ANNOUNCEMENTS BY STATUS ===");
    const ar = await pool.query(`SELECT status, COUNT(*)::int AS c FROM announcements GROUP BY status ORDER BY status`);
    console.table(ar.rows);
  } catch (e) {
    console.error("ERROR:", e.message);
  } finally {
    pool.end();
  }
})();