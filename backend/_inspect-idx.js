const pool = require("./db");
(async () => {
  try {
    const r = await pool.query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename='maintenance_requests'`
    );
    console.log(JSON.stringify(r.rows, null, 1));
  } catch (e) {
    console.error(e.message);
  } finally {
    await pool.end();
  }
})();