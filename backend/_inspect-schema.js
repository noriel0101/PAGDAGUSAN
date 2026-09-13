const pool = require('./backend/db');
(async () => {
  try {
    console.log("=== PAYMENTS TABLE COLUMNS ===");
    const r = await pool.query(
      `SELECT column_name, data_type, is_nullable, column_default, udt_name
       FROM information_schema.columns
       WHERE table_name = 'payments' ORDER BY ordinal_position`
    );
    console.table(r.rows);

    console.log("\n=== PAYMENT_STATUS ENUM VALUES ===");
    const e = await pool.query(
      `SELECT e.enumlabel FROM pg_type t
       JOIN pg_enum e ON t.oid=e.enumtypid
       WHERE t.typname='payment_status'`
    );
    console.log(JSON.stringify(e.rows));

    console.log("\n=== PAYMENTS PRIMARY KEY ===");
    const pk = await pool.query(
      `SELECT c.column_name FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
       WHERE tc.table_name = 'payments' AND tc.constraint_type = 'PRIMARY KEY'`
    );
    console.log(JSON.stringify(pk.rows));

    console.log("\n=== PAYMENTS FOREIGN KEYS ===");
    const fk = await pool.query(
      `SELECT kcu.column_name, ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
       WHERE tc.table_name = 'payments' AND tc.constraint_type = 'FOREIGN KEY'`
    );
    console.log(JSON.stringify(fk.rows));

    console.log("\n=== PAYMENTS INDEXES ===");
    const idx = await pool.query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'payments'`
    );
    console.log(JSON.stringify(idx.rows));

    console.log("\n=== CHECK CONSTRAINTS ON PAYMENTS ===");
    const cc = await pool.query(
      `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conrelid = 'payments'::regclass AND contype = 'c'`
    );
    console.log(JSON.stringify(cc.rows));

    console.log("\n=== ALL ENUM TYPES IN DB ===");
    const enums = await pool.query(
      `SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) as values
       FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
       GROUP BY t.typname`
    );
    console.log(JSON.stringify(enums.rows));

    console.log("\n=== ALL TABLES ===");
    const tables = await pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    console.log(JSON.stringify(tables.rows));

  } catch(e) {
    console.error("ERROR:", e.message);
  } finally {
    pool.end();
  }
})();
