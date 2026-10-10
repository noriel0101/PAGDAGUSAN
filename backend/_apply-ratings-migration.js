const pool = require("./db");
const fs = require("fs");
const path = require("path");

(async () => {
  const sqlFile = path.join(__dirname, "migrations", "2026-10-01-add-ratings.sql");
  const sql = fs.readFileSync(sqlFile, "utf8");
  try {
    await pool.query(sql);
    const cols = await pool.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = 'ratings'
       ORDER BY ordinal_position`
    );
    console.log("ratings columns:");
    for (const c of cols.rows) {
      console.log(
        `  ${c.column_name} : ${c.data_type}${c.is_nullable === "NO" ? " NOT NULL" : ""}${
          c.column_default ? " default=" + c.column_default : ""
        }`
      );
    }
    const idx = await pool.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'ratings' ORDER BY indexname`
    );
    console.log("ratings indexes:", idx.rows.map((r) => r.indexname).join(", "));
  } catch (e) {
    console.error("MIGRATION ERROR:", e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
