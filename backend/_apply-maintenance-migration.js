const pool = require("./db");
const fs = require("fs");
const path = require("path");

(async () => {
  const sqlFile = path.join(__dirname, "migrations", "2026-09-12-add-maintenance-category.sql");
  const sql = fs.readFileSync(sqlFile, "utf8");
  try {
    await pool.query(sql);
    const chk = await pool.query(
      `SELECT column_name, data_type, column_default FROM information_schema.columns
       WHERE table_name='maintenance_requests' AND column_name='category'`
    );
    const enums = await pool.query(
      `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
       WHERE t.typname='maintenance_category' ORDER BY e.enumsortorder`
    );
    console.log("category column:", JSON.stringify(chk.rows));
    console.log("maintenance_category values:", enums.rows.map((r) => r.enumlabel).join(", "));
  } catch (e) {
    console.error("MIGRATION ERROR:", e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();