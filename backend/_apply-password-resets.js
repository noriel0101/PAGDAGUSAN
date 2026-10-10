const pool = require("./db");
const fs = require("fs");
const path = require("path");

(async () => {
  const sqlFile = path.join(__dirname, "migrations", "2026-10-06-add-password-resets.sql");
  const sql = fs.readFileSync(sqlFile, "utf8");
  try {
    await pool.query(sql);
    const table = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'password_resets' ORDER BY ordinal_position`
    );
    console.log("password_resets columns:", table.rows.map((row) => row.column_name).join(", "));
  } catch (error) {
    console.error("MIGRATION ERROR:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
