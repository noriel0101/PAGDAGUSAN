const pool = require("./db");
const fs = require("fs");
const path = require("path");

(async () => {
  const sqlFile = path.join(__dirname, "migrations", "2026-10-01-allow-shared-room-leases.sql");
  const sql = fs.readFileSync(sqlFile, "utf8");
  try {
    await pool.query(sql);
    const idx = await pool.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'leases' ORDER BY indexname`
    );
    console.log("lease indexes:", idx.rows.map((r) => r.indexname).join(", "));
    const sample = await pool.query(
      `SELECT room_number, status, capacity, current_occupancy
       FROM rooms
       WHERE id = '4e760301-fe36-4470-be84-647b041e0760'`
    );
    console.log("room 101:", sample.rows[0] || "not found");
  } catch (e) {
    console.error("MIGRATION ERROR:", e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
