const pool = require("./db");
const fs = require("fs");
const path = require("path");

(async () => {
  const sqlFile = path.join(__dirname, "migrations", "2026-09-13-add-messages-unread-index.sql");
  const sql = fs.readFileSync(sqlFile, "utf8");
  try {
    await pool.query(sql);
    const idx = await pool.query(
      `SELECT indexname FROM pg_indexes WHERE tablename='messages' ORDER BY indexname`
    );
    console.log("messages indexes:", idx.rows.map((r) => r.indexname).join(", "));
  } catch (e) {
    console.error("MIGRATION ERROR:", e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();