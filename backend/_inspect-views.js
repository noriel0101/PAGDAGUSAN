require("dotenv").config();
const pool = require("C:/Users/Reyner Jade/Desktop/PAGDAGUSAN V2/backend/db");

(async () => {
  try {
    console.log("=== VIEW DEFINITIONS ===");
    const views = await pool.query(
      `SELECT viewname, definition FROM pg_views WHERE schemaname='public' ORDER BY viewname`);
    for (const v of views.rows) {
      console.log("\n### " + v.viewname + "\n" + v.definition);
    }

    console.log("\n=== OWNERS ===");
    const owners = await pool.query(
      `SELECT id, name, email, status FROM users WHERE role='owner' ORDER BY name`);
    console.table(owners.rows);

    console.log("\n=== PROPERTIES ===");
    const props = await pool.query(
      `SELECT p.id, p.name, p.owner_id, u.email AS owner_email, p.status, p.address
       FROM properties p JOIN users u ON u.id = p.owner_id`);
    console.table(props.rows);

    console.log("\n=== ROOMS ===");
    const rooms = await pool.query(
      `SELECT r.id, r.room_number, r.property_id, p.owner_id, r.capacity, r.current_occupancy, r.monthly_rent, r.status
       FROM rooms r JOIN properties p ON p.id = r.property_id`);
    console.table(rooms.rows);

    console.log("\n=== LEASES ===");
    const leases = await pool.query(
      `SELECT l.id, l.tenant_id, l.room_id, r.property_id, p.owner_id, l.status, l.start_date, l.end_date, l.monthly_rent
       FROM leases l JOIN rooms r ON r.id=l.room_id JOIN properties p ON p.id=r.property_id`);
    console.table(leases.rows);

    console.log("\n=== PAYMENTS ===");
    const pays = await pool.query(
      `SELECT p.id, p.lease_id, p.tenant_id, p.amount, p.status, p.payment_date, p.billing_period_start, p.billing_period_end
       FROM payments p`);
    console.table(pays.rows);

    console.log("\n=== TENANTS VIEW ROWS ===");
    const tv = await pool.query(`SELECT * FROM owner_tenant_summary LIMIT 20`);
    console.table(tv.rows);

    console.log("\n=== OWNER PROPERTY SUMMARY ROWS ===");
    const ov = await pool.query(`SELECT * FROM owner_property_summary LIMIT 20`);
    console.table(ov.rows);

    console.log("\n=== TENANT CURRENT ROOM ROWS ===");
    const tc = await pool.query(`SELECT * FROM tenant_current_room LIMIT 20`);
    console.table(tc.rows);
  } catch (e) {
    console.error("ERROR:", e.message);
  } finally {
    pool.end();
  }
})();