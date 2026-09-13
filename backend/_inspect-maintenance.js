const pool = require("./db");

(async () => {
  try {
    const tables = ["maintenance_requests", "users", "properties", "rooms", "leases", "payments"];
    for (const t of tables) {
      const cols = await pool.query(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`,
        [t]
      );
      console.log(`\n=== ${t} ===`);
      console.log(JSON.stringify(cols.rows, null, 1));
    }

    const enums = await pool.query(
      `SELECT t.typname, e.enumlabel
       FROM pg_type t JOIN pg_enum e ON t.oid=e.enumtypid
       ORDER BY t.typname, e.enumsortorder`
    );
    console.log("\n=== ENUMS ===");
    const grouped = {};
    for (const r of enums.rows) (grouped[r.typname] = grouped[r.typname] || []).push(r.enumlabel);
    console.log(JSON.stringify(grouped, null, 1));

    const views = await pool.query(
      `SELECT table_name FROM information_schema.views WHERE table_schema='public'`
    );
    console.log("\n=== VIEWS ===");
    console.log(JSON.stringify(views.rows, null, 1));

    const fks = await pool.query(
      `SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name AND ccu.table_schema=tc.table_schema
       WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_name IN ('maintenance_requests','leases','rooms','properties','payments')
       ORDER BY tc.table_name, kcu.column_name`
    );
    console.log("\n=== FOREIGN KEYS ===");
    console.log(JSON.stringify(fks.rows, null, 1));
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
})();