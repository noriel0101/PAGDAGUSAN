/**
 * Reports module integration/security test.
 * Covers: owner summary & detail reports, real-data accuracy, owner isolation,
 * empty-property safety (no division errors, zero counts), role isolation (403),
 * unauthenticated (401), and admin owner-report summary.
 *
 * Requires: server running on :5000 with the latest route code.
 * Cleans up all test-created data after run.
 */
const API = "http://localhost:5000";

let passed = 0;
let failed = 0;

function assert(label, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

async function req(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function loginToken(res) {
  return res?.json?.token ?? res?.json?.data?.token ?? null;
}

function dataOf(res) {
  return res?.json?.data;
}

const TS = Date.now();
const OWNER_A_EMAIL = `rep_ownera_${TS}@test.com`;
const OWNER_B_EMAIL = `rep_ownerb_${TS}@test.com`;
const OWNER_C_EMAIL = `rep_ownerc_${TS}@test.com`;
const TENANT_A_EMAIL = `rep_tenanta_${TS}@test.com`;
const PW = "Test1234!";

let ownerAToken, ownerBToken, ownerCtoken, tenantAToken, adminToken;
let propA, propB;
let roomA1, roomA2, roomB1;
let paymentId;

async function activateOwners(...ids) {
  const pool = require("./db");
  await pool.query(`UPDATE users SET status = 'active' WHERE id = ANY($1::uuid[])`, [ids]);
}

// ─── Setup ────────────────────────────────────────────────
async function setup() {
  console.log("\n=== SETUP ===");

  let r = await req("POST", "/api/auth/register-owner", {
    name: "Rep Owner A", email: OWNER_A_EMAIL, phone: "09123456711", password: PW,
  });
  assert("Owner A registered", r.status === 201, `status=${r.status}`);
  const ownerAId = r.json?.data?.id;

  r = await req("POST", "/api/auth/register-owner", {
    name: "Rep Owner B", email: OWNER_B_EMAIL, phone: "09123456712", password: PW,
  });
  assert("Owner B registered", r.status === 201, `status=${r.status}`);
  const ownerBId = r.json?.data?.id;

  r = await req("POST", "/api/auth/register-owner", {
    name: "Rep Owner C", email: OWNER_C_EMAIL, phone: "09123456713", password: PW,
  });
  assert("Owner C registered", r.status === 201, `status=${r.status}`);
  const ownerCId = r.json?.data?.id;

  await activateOwners(ownerAId, ownerBId, ownerCId);

  r = await req("POST", "/api/auth/login", { email: OWNER_A_EMAIL, password: PW });
  assert("Owner A logs in", r.status === 200, `status=${r.status}`);
  ownerAToken = loginToken(r);

  r = await req("POST", "/api/auth/login", { email: OWNER_B_EMAIL, password: PW });
  assert("Owner B logs in", r.status === 200, `status=${r.status}`);
  ownerBToken = loginToken(r);

  r = await req("POST", "/api/auth/login", { email: OWNER_C_EMAIL, password: PW });
  assert("Owner C logs in", r.status === 200, `status=${r.status}`);
  ownerCtoken = loginToken(r);

  // Admin (for role isolation + admin report)
  r = await req("POST", "/api/auth/login", { email: "admin@pagdagusan.com", password: "Admin123!" });
  adminToken = loginToken(r);
  if (adminToken) console.log("  INFO  Admin token acquired");
  else console.log("  WARN  Admin login unavailable, skipping admin assertions");

  // Owner A: property + 2 rooms + tenant with active lease
  r = await req("POST", "/api/owner/properties", { name: "Rep Test Dorm A", address: "1 Rep St A" }, ownerAToken);
  assert("Owner A creates property", r.status === 201, `status=${r.status}`);
  propA = r.json?.data;

  if (propA) {
    r = await req("POST", "/api/owner/rooms", {
      propertyId: propA.id, roomNumber: "REP-101", monthlyRent: 5000, capacity: 3,
    }, ownerAToken);
    assert("Owner A creates room 101", r.status === 201, `status=${r.status}`);
    roomA1 = r.json?.data;

    r = await req("POST", "/api/owner/rooms", {
      propertyId: propA.id, roomNumber: "REP-102", monthlyRent: 6000, capacity: 5,
    }, ownerAToken);
    assert("Owner A creates room 102", r.status === 201, `status=${r.status}`);
    roomA2 = r.json?.data;
  }

  // Owner B: property + 1 room
  r = await req("POST", "/api/owner/properties", { name: "Rep Test Dorm B", address: "2 Rep St B" }, ownerBToken);
  assert("Owner B creates property", r.status === 201, `status=${r.status}`);
  propB = r.json?.data;

  if (propB) {
    r = await req("POST", "/api/owner/rooms", {
      propertyId: propB.id, roomNumber: "REP-201", monthlyRent: 7000, capacity: 4,
    }, ownerBToken);
    assert("Owner B creates room", r.status === 201, `status=${r.status}`);
    roomB1 = r.json?.data;
  }

  // Tenant A with active lease on Owner A's room (a "reservation" of status active)
  r = await req("POST", "/api/owner/tenants", {
    name: "Rep Tenant A", email: TENANT_A_EMAIL, phone: "09123456714", password: PW, roomId: roomA1?.id,
  }, ownerAToken);
  assert("Tenant A created with active lease", r.status === 201 && r.json?.data?.leaseId, `status=${r.status}`);
  r = await req("POST", "/api/auth/login", { email: TENANT_A_EMAIL, password: PW });
  assert("Tenant A logs in", r.status === 200, `status=${r.status}`);
  tenantAToken = loginToken(r);

  // Tenant A submits a pending payment for September
  r = await req("POST", "/api/tenant/payments", {
    amount: 5000, paymentMethod: "gcash", paymentDate: "2026-09-15",
    referenceNumber: "REP-PAY1",
    billingPeriodStart: "2026-09-01", billingPeriodEnd: "2026-09-30",
  }, tenantAToken);
  assert("Tenant A submits pending payment", r.status === 201, `status=${r.status}`);
  paymentId = r.json?.data?.id || r.json?.payment?.id;
  r = await req("PATCH", `/api/owner/payments/${paymentId}/verify`, null, ownerAToken);
  assert("Owner A verifies payment → paid", r.status === 200 && r.json?.data?.status === "paid", `status=${r.status}, payment=${JSON.stringify(r.json?.data)}`);

  // Tenant A submits a high-priority maintenance request
  r = await req("POST", "/api/tenant/maintenance", {
    title: "Leaking pipe", description: "Ceiling leak in the bathroom", category: "plumbing", priority: "high",
  }, tenantAToken);
  assert("Tenant A submits maintenance request", r.status === 201, `status=${r.status}`);

  // Owner A creates + publishes one announcement
  r = await req("POST", "/api/owner/announcements", {
    title: "Reptenance shutdown", content: "Water will be off Saturday 10am-2pm", propertyId: propA?.id,
  }, ownerAToken);
  assert("Owner A creates announcement", r.status === 201, `status=${r.status}`);
  const annId = r.json?.data?.id;
  if (annId) {
    r = await req("PATCH", `/api/owner/announcements/${annId}/publish`, null, ownerAToken);
    assert("Owner A publishes announcement", r.status === 200, `status=${r.status}`);
  }
}

// ─── Owner A summary ──────────────────────────────────────
async function testOwnerASummary() {
  console.log("\n=== TEST: Owner A Summary & Details ===");

  let r = await req("GET", "/api/owner/reports/summary", null, ownerAToken);
  assert("Summary → 200", r.status === 200, `status=${r.status}`);
  const s = dataOf(r);
  if (!s) return;

  assert("properties.total = 1", s.properties.total === 1, `${s.properties.total}`);
  assert("properties.active = 1", s.properties.active === 1, `${s.properties.active}`);

  assert("rooms.total = 2", s.rooms.total === 2, `${s.rooms.total}`);
  assert("rooms.available = 2", s.rooms.available === 2, `${s.rooms.available}`);

  assert("tenants.total = 1", s.tenants.total === 1, `${s.tenants.total}`);
  assert("tenants.active = 1", s.tenants.active === 1, `${s.tenants.active}`);

  assert("reservations.total = 1 (active lease)", s.reservations.total === 1, `${s.reservations.total}`);
  assert("reservations.active = 1", s.reservations.active === 1, `${s.reservations.active}`);

  assert("payments.total = 1", s.payments.total === 1, `${s.payments.total}`);
  assert("payments.pending = 0 (verified below)", s.payments.pending === 0, `${s.payments.pending}`);
  assert("payments.paid = 1", s.payments.paid === 1, `${s.payments.paid}`);
  assert("payments.totalPaidAmount = 5000", s.payments.totalPaidAmount === 5000, `${s.payments.totalPaidAmount}`);
  assert("payments.pendingAmount = 0", s.payments.pendingAmount === 0, `${s.payments.pendingAmount}`);

  assert("maintenance.total = 1", s.maintenance.total === 1, `${s.maintenance.total}`);
  assert("maintenance.pending = 1", s.maintenance.pending === 1, `${s.maintenance.pending}`);
  assert("maintenance.highPriority = 1", s.maintenance.highPriority === 1, `${s.maintenance.highPriority}`);

  assert("announcements.total = 1", s.announcements.total === 1, `${s.announcements.total}`);
  assert("announcements.published = 1", s.announcements.published === 1, `${s.announcements.published}`);

  assert("messages are non-negative numbers",
    typeof s.messages.totalConversations === "number" && s.messages.totalConversations >= 0 &&
    typeof s.messages.unread === "number" && s.messages.unread >= 0,
    `${JSON.stringify(s.messages)}`);
}

// ─── Owner A detail reports ───────────────────────────────
async function testOwnerADetails() {
  console.log("\n=== TEST: Owner A Detail Reports ===");

  let r = await req("GET", "/api/owner/reports/property", null, ownerAToken);
  assert("Property → 200", r.status === 200, `status=${r.status}`);
  const p = dataOf(r);
  assert("Property id matches", p?.id === propA?.id, `got=${p?.id}`);
  assert("Property totalRooms = 2", p?.totalRooms === 2, `${p?.totalRooms}`);
  assert("Property totalCapacity = 8", p?.totalCapacity === 8, `${p?.totalCapacity}`);
  assert("Property currentOccupancy = 1 (tenant moved in)", p?.currentOccupancy === 1, `${p?.currentOccupancy}`);
  assert("Property availableSlots = 7", p?.availableSlots === 7, `${p?.availableSlots}`);
  assert("Property occupancyRate = 13 (no division error)", p?.occupancyRate === 13, `${p?.occupancyRate}`);

  r = await req("GET", "/api/owner/reports/rooms", null, ownerAToken);
  assert("Rooms → 200", r.status === 200, `status=${r.status}`);
  const rooms = dataOf(r);
  assert("Rooms total = 2", rooms?.rooms.total === 2, `${rooms?.rooms.total}`);
  const roomNumbers = (rooms?.breakdown ?? []).map((x) => x.roomNumber);
  assert("Rooms breakdown contains REP-101 and REP-102",
    roomNumbers.includes("REP-101") && roomNumbers.includes("REP-102"), `${roomNumbers.join(",")}`);
  assert("Rooms breakdown excludes owner B's room",
    !roomNumbers.includes("REP-201"), `${roomNumbers.join(",")}`);

  r = await req("GET", "/api/owner/reports/tenants", null, ownerAToken);
  const tenants = dataOf(r);
  assert("Tenants total = 1", tenants?.tenants.total === 1, `${tenants?.tenants.total}`);
  assert("Tenants active = 1", tenants?.tenants.active === 1, `${tenants?.tenants.active}`);

  r = await req("GET", "/api/owner/reports/reservations", null, ownerAToken);
  assert("Reservations → 200", r.status === 200, `status=${r.status}`);
  const resv = dataOf(r);
  assert("Reservations recent has 1 entry", resv?.recent.length === 1, `${resv?.recent.length}`);
  assert("Reservations recent tenant = Rep Tenant A", resv?.recent[0]?.tenantName === "Rep Tenant A", `${resv?.recent[0]?.tenantName}`);

  r = await req("GET", "/api/owner/reports/payments", null, ownerAToken);
  const pay = dataOf(r);
  assert("Payments paid = 1", pay?.payments.paid === 1, `${pay?.payments.paid}`);
  assert("Payments totalPaidAmount = 5000", pay?.payments.totalPaidAmount === 5000, `${pay?.payments.totalPaidAmount}`);

  r = await req("GET", "/api/owner/reports/payment-trend", null, ownerAToken);
  assert("Payment trend → 200", r.status === 200, `status=${r.status}`);
  const trend = dataOf(r);
  const sep = (trend ?? []).find((t) => t.period === "2026-09");
  assert("Trend includes 2026-09 with 5000/1", sep?.amount === 5000 && sep?.count === 1, `${JSON.stringify(sep)}`);

  r = await req("GET", "/api/owner/reports/payment-trend?bucket=week", null, ownerAToken);
  assert("Weekly payment trend → 200", r.status === 200, `status=${r.status}`);
  assert("Weekly payment trend is array", Array.isArray(dataOf(r)), `${JSON.stringify(dataOf(r))}`);

  r = await req("GET", "/api/owner/reports/maintenance", null, ownerAToken);
  const maint = dataOf(r);
  assert("Maintenance pending = 1", maint?.maintenance.pending === 1, `${maint?.maintenance.pending}`);
  assert("Maintenance avgCompletionHours = null (none completed)", maint?.maintenance.avgCompletionHours === null, `${maint?.maintenance.avgCompletionHours}`);
  assert("Maintenance byCategory includes plumbing",
    Array.isArray(maint?.byCategory) && maint.byCategory.some((c) => c.category === "plumbing" && c.count >= 1),
    `${JSON.stringify(maint?.byCategory)}`);
  assert("Maintenance byPriority includes high",
    Array.isArray(maint?.byPriority) && maint.byPriority.some((p) => p.priority === "high" && p.count >= 1),
    `${JSON.stringify(maint?.byPriority)}`);

  r = await req("GET", "/api/owner/reports/maintenance-trend", null, ownerAToken);
  assert("Maintenance trend → 200", r.status === 200, `status=${r.status}`);
  const mTrend = dataOf(r);
  assert("Maintenance trend is a non-empty array", Array.isArray(mTrend) && mTrend.length >= 1, `${JSON.stringify(mTrend)}`);
  assert("Maintenance trend month total >= 1", (mTrend ?? []).some((t) => t.total >= 1), `${JSON.stringify(mTrend)}`);

  r = await req("GET", "/api/owner/reports/announcements", null, ownerAToken);
  const ann = dataOf(r);
  assert("Announcements published = 1", ann?.announcements.published === 1, `${ann?.announcements.published}`);
  assert("Announcements recent title matches", ann?.recent[0]?.title === "Reptenance shutdown", `${ann?.recent[0]?.title}`);

  r = await req("GET", "/api/owner/reports/messages", null, ownerAToken);
  assert("Messages → 200", r.status === 200, `status=${r.status}`);
  const msg = dataOf(r);
  assert("Messages counters are numbers", typeof msg?.messages.totalConversations === "number" && typeof msg?.messages.unread === "number", `${JSON.stringify(msg)}`);
}

// ─── Owner isolation ──────────────────────────────────────
async function testIsolation() {
  console.log("\n=== TEST: Owner Isolation ===");

  let r = await req("GET", "/api/owner/reports/summary", null, ownerBToken);
  assert("Owner B summary → 200", r.status === 200, `status=${r.status}`);
  const sB = dataOf(r);
  assert("Owner B properties.total = 1 (not 2)", sB?.properties.total === 1, `${sB?.properties.total}`);
  assert("Owner B rooms.total = 1 (not 3)", sB?.rooms.total === 1, `${sB?.rooms.total}`);
  assert("Owner B tenants.total = 0", sB?.tenants.total === 0, `${sB?.tenants.total}`);
  assert("Owner B reservations.total = 0", sB?.reservations.total === 0, `${sB?.reservations.total}`);
  assert("Owner B payments.total = 0", sB?.payments.total === 0, `${sB?.payments.total}`);
  assert("Owner B maintenance.total = 0", sB?.maintenance.total === 0, `${sB?.maintenance.total}`);
  assert("Owner B announcements.total = 0", sB?.announcements.total === 0, `${sB?.announcements.total}`);

  r = await req("GET", "/api/owner/reports/property", null, ownerBToken);
  const pB = dataOf(r);
  assert("Owner B property id is own", pB?.id === propB?.id, `got=${pB?.id}`);
  assert("Owner B property totalRooms = 1", pB?.totalRooms === 1, `${pB?.totalRooms}`);

  r = await req("GET", "/api/owner/reports/payment-trend", null, ownerBToken);
  assert("Owner B trend is empty", Array.isArray(dataOf(r)) && dataOf(r).length === 0, `${JSON.stringify(dataOf(r))}`);

  r = await req("GET", "/api/owner/reports/maintenance-trend", null, ownerBToken);
  assert("Owner B maintenance trend is empty", Array.isArray(dataOf(r)) && dataOf(r).length === 0, `${JSON.stringify(dataOf(r))}`);
}

// ─── Empty / no-property owner ────────────────────────────
async function testEmptyOwner() {
  console.log("\n=== TEST: Empty Owner (no property) ===");

  let r = await req("GET", "/api/owner/reports/summary", null, ownerCtoken);
  assert("Empty owner summary → 200", r.status === 200, `status=${r.status}`);
  const s = dataOf(r);
  assert("Empty owner properties.total = 0", s?.properties.total === 0, `${s?.properties.total}`);
  assert("Empty owner rooms.total = 0", s?.rooms.total === 0, `${s?.rooms.total}`);
  assert("Empty owner tenants.total = 0", s?.tenants.total === 0, `${s?.tenants.total}`);
  assert("Empty owner payments.total = 0", s?.payments.total === 0, `${s?.payments.total}`);
  assert("Empty owner maintenance.total = 0", s?.maintenance.total === 0, `${s?.maintenance.total}`);
  assert("Empty owner announcements.total = 0", s?.announcements.total === 0, `${s?.announcements.total}`);

  r = await req("GET", "/api/owner/reports/property", null, ownerCtoken);
  assert("Empty owner property → data null", dataOf(r) === null, `${JSON.stringify(dataOf(r))}`);

  r = await req("GET", "/api/owner/reports/rooms", null, ownerCtoken);
  const rooms = dataOf(r);
  assert("Empty owner rooms.breakdown empty", Array.isArray(rooms?.breakdown) && rooms.breakdown.length === 0, `${JSON.stringify(rooms)}`);
  assert("Empty owner rooms.total = 0", rooms?.rooms.total === 0, `${rooms?.rooms.total}`);

  r = await req("GET", "/api/owner/reports/payment-trend", null, ownerCtoken);
  assert("Empty owner trend empty", Array.isArray(dataOf(r)) && dataOf(r).length === 0, `${JSON.stringify(dataOf(r))}`);

  r = await req("GET", "/api/owner/reports/maintenance", null, ownerCtoken);
  assert("Empty owner maintenance avg = null", dataOf(r)?.maintenance.avgCompletionHours === null, `${JSON.stringify(dataOf(r))}`);

  r = await req("GET", "/api/owner/reports/maintenance-trend", null, ownerCtoken);
  assert("Empty owner maintenance trend empty", Array.isArray(dataOf(r)) && dataOf(r).length === 0, `${JSON.stringify(dataOf(r))}`);
}

// ─── Role isolation ───────────────────────────────────────
async function testRoleIsolation() {
  console.log("\n=== TEST: Role Isolation ===");

  let r = await req("GET", "/api/owner/reports/summary", null, tenantAToken);
  assert("Tenant blocked from owner reports → 403", r.status === 403, `status=${r.status}`);

  if (adminToken) {
    r = await req("GET", "/api/owner/reports/summary", null, adminToken);
    assert("Admin blocked from owner reports → 403", r.status === 403, `status=${r.status}`);

    r = await req("GET", "/api/admin/reports/summary", null, adminToken);
    assert("Admin report summary → 200", r.status === 200, `status=${r.status}`);
    const summary = dataOf(r)?.summary;
    assert("Admin summary has numeric owner fields",
      typeof summary?.totalOwners === "number" && typeof summary?.activeOwners === "number" &&
      typeof summary?.pendingOwners === "number" && typeof summary?.suspendedOwners === "number",
      `${JSON.stringify(summary)}`);

    r = await req("GET", "/api/admin/reports/summary", null, ownerAToken);
    assert("Owner blocked from admin reports → 403", r.status === 403, `status=${r.status}`);
  }

  r = await req("GET", "/api/owner/reports/summary");
  assert("Unauthenticated → 401", r.status === 401, `status=${r.status}`);
}

// ─── Cleanup ──────────────────────────────────────────────
async function cleanup() {
  console.log("\n=== CLEANUP ===");
  const pool = require("./db");
  const emails = [OWNER_A_EMAIL, OWNER_B_EMAIL, OWNER_C_EMAIL, TENANT_A_EMAIL];
  try {
    await pool.query(
      `DELETE FROM payments WHERE tenant_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [emails]
    );
    await pool.query(
      `DELETE FROM leases WHERE tenant_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [emails]
    );
    await pool.query(
      `DELETE FROM maintenance_requests WHERE tenant_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [emails]
    );
    await pool.query(`DELETE FROM announcements WHERE owner_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [emails]);
    if (roomA1) await pool.query("DELETE FROM rooms WHERE id = $1", [roomA1.id]);
    if (roomA2) await pool.query("DELETE FROM rooms WHERE id = $1", [roomA2.id]);
    if (roomB1) await pool.query("DELETE FROM rooms WHERE id = $1", [roomB1.id]);
    await pool.query(`DELETE FROM properties WHERE name LIKE 'Rep Test Dorm %'`);
    await pool.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [emails]);
    console.log("  Done — test data removed");
  } catch (e) {
    console.error("  Cleanup error:", e.message);
  } finally {
    await pool.end();
  }
}

// ─── Main ─────────────────────────────────────────────────
(async () => {
  try {
    await setup();
    await testOwnerASummary();
    await testOwnerADetails();
    await testIsolation();
    await testEmptyOwner();
    await testRoleIsolation();
  } catch (err) {
    console.error("\nFATAL:", err);
    failed++;
  } finally {
    await cleanup();
  }

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
})();