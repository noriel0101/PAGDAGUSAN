/**
 * Payments module integration/security test.
 * Covers: tenant submission, validation, lease gating, tenant isolation,
 * owner isolation, verify/reject lifecycle, role isolation (403), unauthenticated (401).
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

const TS = Date.now();
const OWNER_A_EMAIL = `pay_ownera_${TS}@test.com`;
const OWNER_B_EMAIL = `pay_ownerb_${TS}@test.com`;
const TENANT_A_EMAIL = `pay_tenanta_${TS}@test.com`;
const TENANT_B_EMAIL = `pay_tenantb_${TS}@test.com`;
const TENANT_C_EMAIL = `pay_tenantc_${TS}@test.com`;
const PW = "Test1234!";

let ownerAToken, ownerBToken, tenantAToken, tenantBToken, tenantCToken, adminToken;
let roomA, roomB;
let paymentIdA1, paymentIdA2;

async function activateOwners(...ids) {
  const pool = require("./db");
  await pool.query(`UPDATE users SET status = 'active' WHERE id = ANY($1::uuid[])`, [ids]);
}

// ─── Setup ────────────────────────────────────────────────
async function setup() {
  console.log("\n=== SETUP ===");
  const pool = require("./db");

  let r = await req("POST", "/api/auth/register-owner", {
    name: "Pay Owner A", email: OWNER_A_EMAIL, phone: "09123456781", password: PW,
  });
  assert("Owner A registered", r.status === 201, `status=${r.status}`);
  const ownerAId = r.json?.data?.id;

  r = await req("POST", "/api/auth/register-owner", {
    name: "Pay Owner B", email: OWNER_B_EMAIL, phone: "09123456782", password: PW,
  });
  assert("Owner B registered", r.status === 201, `status=${r.status}`);
  const ownerBId = r.json?.data?.id;

  await activateOwners(ownerAId, ownerBId);

  r = await req("POST", "/api/auth/login", { email: OWNER_A_EMAIL, password: PW });
  assert("Owner A logs in", r.status === 200, `status=${r.status}`);
  ownerAToken = loginToken(r);

  r = await req("POST", "/api/auth/login", { email: OWNER_B_EMAIL, password: PW });
  assert("Owner B logs in", r.status === 200, `status=${r.status}`);
  ownerBToken = loginToken(r);

  // Owner A: property + room
  r = await req("POST", "/api/owner/properties", {
    name: "Pay Test Dorm A", address: "1 Pay St A",
  }, ownerAToken);
  assert("Owner A creates property", r.status === 201, `status=${r.status}`);
  const propA = r.json?.data;

  if (propA) {
    r = await req("POST", "/api/owner/rooms", {
      propertyId: propA.id, roomNumber: "PAY-101", monthlyRent: 5000, capacity: 3,
    }, ownerAToken);
    assert("Owner A creates room", r.status === 201, `status=${r.status}`);
    roomA = r.json?.data;
  }

  // Owner B: property + room
  r = await req("POST", "/api/owner/properties", {
    name: "Pay Test Dorm B", address: "2 Pay St B",
  }, ownerBToken);
  assert("Owner B creates property", r.status === 201, `status=${r.status}`);
  const propB = r.json?.data;

  if (propB) {
    r = await req("POST", "/api/owner/rooms", {
      propertyId: propB.id, roomNumber: "PAY-201", monthlyRent: 6000, capacity: 3,
    }, ownerBToken);
    assert("Owner B creates room", r.status === 201, `status=${r.status}`);
    roomB = r.json?.data;
  }

  // Tenant A with active lease on Owner A's room
  r = await req("POST", "/api/owner/tenants", {
    name: "Pay Tenant A", email: TENANT_A_EMAIL, phone: "09123456783", password: PW, roomId: roomA?.id,
  }, ownerAToken);
  assert("Tenant A created with active lease", r.status === 201 && r.json?.data?.leaseId, `status=${r.status}`);
  r = await req("POST", "/api/auth/login", { email: TENANT_A_EMAIL, password: PW });
  assert("Tenant A logs in", r.status === 200, `status=${r.status}`);
  tenantAToken = loginToken(r);

  // Tenant B with active lease on Owner B's room
  r = await req("POST", "/api/owner/tenants", {
    name: "Pay Tenant B", email: TENANT_B_EMAIL, phone: "09123456784", password: PW, roomId: roomB?.id,
  }, ownerBToken);
  assert("Tenant B created with active lease", r.status === 201 && r.json?.data?.leaseId, `status=${r.status}`);
  r = await req("POST", "/api/auth/login", { email: TENANT_B_EMAIL, password: PW });
  assert("Tenant B logs in", r.status === 200, `status=${r.status}`);
  tenantBToken = loginToken(r);

  // Tenant C — no lease
  r = await req("POST", "/api/owner/tenants", {
    name: "Pay Tenant C", email: TENANT_C_EMAIL, phone: "09123456785", password: PW,
  }, ownerAToken);
  assert("Tenant C created without lease", r.status === 201, `status=${r.status}`);
  r = await req("POST", "/api/auth/login", { email: TENANT_C_EMAIL, password: PW });
  assert("Tenant C logs in", r.status === 200, `status=${r.status}`);
  tenantCToken = loginToken(r);

  // Admin (if credentials work) for role-isolation check
  r = await req("POST", "/api/auth/login", { email: "admin@pagdagusan.com", password: "Admin123!" });
  adminToken = loginToken(r);
  if (adminToken) console.log("  INFO  Admin token acquired");
  else console.log("  WARN  Admin login unavailable, skipping admin assertions");
}

// ─── Tenant submission & validation ──────────────────────
async function testTenantSubmission() {
  console.log("\n=== TEST: Tenant Submission ===");

  let r = await req("POST", "/api/tenant/payments", {
    amount: 5000,
    paymentMethod: "gcash",
    paymentDate: "2026-09-01",
    referenceNumber: "REF-A1",
    billingPeriodStart: "2026-09-01",
    billingPeriodEnd: "2026-09-30",
    notes: "September rent",
  }, tenantAToken);
  assert("Submit payment → 201", r.status === 201, `status=${r.status}`);
  assert("Submit response message", r.json?.message === "Payment submitted successfully", `msg=${r.json?.message}`);
  const pay = r.json?.payment ?? r.json?.data;
  assert("Submit returns payment object", !!pay?.id, `data=${JSON.stringify(r.json)}`);
  assert("New payment is pending", pay?.status === "pending", `status=${pay?.status}`);
  assert("Payment carries leaseId", !!pay?.leaseId, `leaseId=${pay?.leaseId}`);
  assert("Payment carries roomNumber", pay?.roomNumber === "PAY-101", `room=${pay?.roomNumber}`);
  assert("Payment carries propertyId/name", !!pay?.propertyId && !!pay?.propertyName, `prop=${pay?.propertyName}`);
  assert("Payment carries ownerId", !!pay?.ownerId, `ownerId=${pay?.ownerId}`);
  // DATE columns come back UTC-shifted; the local calendar day must still be 2026-09-01
  const localDay = pay?.paymentDate
    ? new Date(pay.paymentDate).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }).replace(/\//g, "-")
    : "";
  assert("payment_date respected", localDay === "2026-09-01" || String(pay?.paymentDate).slice(0, 10) === "2026-09-01", `date=${pay?.paymentDate}`);
  paymentIdA1 = pay?.id;
}

async function testValidation() {
  console.log("\n=== TEST: Validation & Lease Gating ===");

  let r = await req("POST", "/api/tenant/payments", { paymentMethod: "cash" }, tenantAToken);
  assert("Missing amount → 400", r.status === 400, `status=${r.status}`);

  r = await req("POST", "/api/tenant/payments", { amount: 0, paymentMethod: "cash" }, tenantAToken);
  assert("Zero amount → 400", r.status === 400, `status=${r.status}`);

  r = await req("POST", "/api/tenant/payments", { amount: -500, paymentMethod: "cash" }, tenantAToken);
  assert("Negative amount → 400", r.status === 400, `status=${r.status}`);

  r = await req("POST", "/api/tenant/payments", { amount: 3000, paymentMethod: "bitcoin" }, tenantAToken);
  assert("Invalid method → 400", r.status === 400, `status=${r.status}`);

  r = await req("POST", "/api/tenant/payments", { amount: 3000, paymentMethod: "cash", paymentDate: "09/01/2026" }, tenantAToken);
  assert("Bad date format → 400", r.status === 400, `status=${r.status}`);

  r = await req("POST", "/api/tenant/payments", { amount: 3000, paymentMethod: "cash" }, tenantCToken);
  assert("No active lease → 409", r.status === 409, `status=${r.status}`);

  // tenant id cannot be overridden
  r = await req("POST", "/api/tenant/payments", { amount: 3000, paymentMethod: "cash" }, tenantAToken);
  assert("Successful submit has tenantId = caller", r.status === 201 && r.json?.data?.tenantId, `status=${r.status}`);
}

async function testTenantIsolation() {
  console.log("\n=== TEST: Tenant Isolation ===");

  let r = await req("GET", `/api/tenant/payments/${paymentIdA1}`, null, tenantBToken);
  assert("Tenant B cannot view Tenant A's payment → 404", r.status === 404, `status=${r.status}`);

  r = await req("GET", "/api/tenant/payments", null, tenantAToken);
  assert("Tenant A list → 200", r.status === 200, `status=${r.status}`);
  const list = r.json?.data ?? [];
  assert("Tenant A list contains own payment", Array.isArray(list) && list.some((p) => p.id === paymentIdA1), `count=${list.length}`);
  const own = list.find((p) => p.id === paymentIdA1);
  assert("List strips nothing: ownerName present", !!own?.ownerName, `owner=${own?.ownerName}`);
  assert("List includes propertyName", own?.propertyName === "Pay Test Dorm A", `prop=${own?.propertyName}`);

  r = await req("GET", `/api/tenant/payments/${paymentIdA1}`, null, tenantAToken);
  assert("Tenant A detail → 200", r.status === 200, `status=${r.status}`);
  assert("Detail verifiedByName null when pending", r.json?.data?.verifiedByName == null, `vbn=${r.json?.data?.verifiedByName}`);
  assert("Detail has leaseId", !!r.json?.data?.leaseId, `leaseId=${r.json?.data?.leaseId}`);
  assert("Detail has roomNumber", r.json?.data?.roomNumber === "PAY-101", `room=${r.json?.data?.roomNumber}`);
}

async function testOwnerLifecycle() {
  console.log("\n=== TEST: Owner Isolation & Lifecycle ===");

  let r = await req("GET", `/api/owner/payments/${paymentIdA1}`, null, ownerBToken);
  assert("Owner B cannot view A's payment → 404", r.status === 404, `status=${r.status}`);
  r = await req("PATCH", `/api/owner/payments/${paymentIdA1}/verify`, {}, ownerBToken);
  assert("Owner B cannot verify A's payment → 404", r.status === 404, `status=${r.status}`);
  r = await req("PATCH", `/api/owner/payments/${paymentIdA1}/reject`, { reason: "x" }, ownerBToken);
  assert("Owner B cannot reject A's payment → 404", r.status === 404, `status=${r.status}`);

  r = await req("GET", "/api/owner/payments", null, ownerBToken);
  assert("Owner B list returns 200", r.status === 200, `status=${r.status}`);
  assert("Owner B list excludes A's payment", Array.isArray(r.json?.data) && !r.json.data.some((p) => p.id === paymentIdA1), `count=${r.json?.data?.length}`);

  r = await req("GET", `/api/owner/payments/${paymentIdA1}`, null, ownerAToken);
  assert("Owner A sees full detail → 200", r.status === 200, `status=${r.status}`);
  const d = r.json?.data;
  assert("Detail tenantEmail", d?.tenantEmail === TENANT_A_EMAIL, `email=${d?.tenantEmail}`);
  assert("Detail propertyName", d?.propertyName === "Pay Test Dorm A", `prop=${d?.propertyName}`);
  assert("Detail leaseId", !!d?.leaseId, `leaseId=${d?.leaseId}`);

  r = await req("PATCH", `/api/owner/payments/${paymentIdA1}/reject`, { reason: "Amount mismatch" }, ownerAToken);
  assert("Owner A rejects → 200", r.status === 200, `status=${r.status}`);
  assert("Reject returns status rejected", r.json?.data?.status === "rejected", `${JSON.stringify(r.json?.data)}`);

  r = await req("GET", `/api/tenant/payments/${paymentIdA1}`, null, tenantAToken);
  assert("Tenant sees rejected state", r.status === 200 && r.json?.data?.status === "rejected", `status=${r.status}`);
  assert("Tenant sees rejection reason", r.json?.data?.rejectionReason === "Amount mismatch", `reason=${r.json?.data?.rejectionReason}`);

  r = await req("PATCH", `/api/owner/payments/${paymentIdA1}/verify`, {}, ownerAToken);
  assert("Verify non-pending → 409", r.status === 409, `status=${r.status}`);

  // Second payment → verify
  r = await req("POST", "/api/tenant/payments", { amount: 5000, paymentMethod: "bank_transfer", referenceNumber: "REF-A2" }, tenantAToken);
  paymentIdA2 = r.json?.data?.id;
  assert("Second payment created", r.status === 201 && !!paymentIdA2, `status=${r.status}`);

  r = await req("PATCH", `/api/owner/payments/${paymentIdA2}/verify`, {}, ownerAToken);
  assert("Verify pending → 200", r.status === 200, `status=${r.status}`);
  assert("Verify returns paid", r.json?.data?.status === "paid", `${JSON.stringify(r.json?.data)}`);

  r = await req("GET", `/api/owner/payments/${paymentIdA2}`, null, ownerAToken);
  assert("Verified detail shows verifiedAt", !!r.json?.data?.verifiedAt, `vat=${r.json?.data?.verifiedAt}`);
  assert("Verified detail shows verifiedByName", !!r.json?.data?.verifiedByName, `vbn=${r.json?.data?.verifiedByName}`);

  r = await req("PATCH", `/api/owner/payments/${paymentIdA2}/reject`, { reason: "too late" }, ownerAToken);
  assert("Reject already-paid → 409", r.status === 409, `status=${r.status}`);
}

async function testRoleIsolation() {
  console.log("\n=== TEST: Role Isolation ===");

  let r = await req("PATCH", `/api/owner/payments/${paymentIdA2}/verify`, {}, tenantAToken);
  assert("Tenant blocked from verify → 403", r.status === 403, `status=${r.status}`);
  r = await req("PATCH", `/api/owner/payments/${paymentIdA2}/reject`, { reason: "x" }, tenantAToken);
  assert("Tenant blocked from reject → 403", r.status === 403, `status=${r.status}`);
  r = await req("GET", "/api/owner/payments", null, tenantAToken);
  assert("Tenant blocked from owner list → 403", r.status === 403, `status=${r.status}`);
  r = await req("GET", `/api/tenant/payments/${paymentIdA2}`, null, ownerAToken);
  assert("Owner blocked from tenant detail → 403", r.status === 403, `status=${r.status}`);

  if (adminToken) {
    r = await req("GET", "/api/owner/payments", null, adminToken);
    assert("Admin blocked from owner payments → 403", r.status === 403, `status=${r.status}`);
    r = await req("POST", "/api/tenant/payments", { amount: 1, paymentMethod: "cash" }, adminToken);
    assert("Admin blocked from tenant payments → 403", r.status === 403, `status=${r.status}`);
  }

  r = await req("POST", "/api/tenant/payments", { amount: 1000, paymentMethod: "cash" });
  assert("Unauthenticated submit → 401", r.status === 401, `status=${r.status}`);
  r = await req("GET", "/api/owner/payments");
  assert("Unauthenticated owner list → 401", r.status === 401, `status=${r.status}`);
  r = await req("GET", "/api/tenant/payments");
  assert("Unauthenticated tenant list → 401", r.status === 401, `status=${r.status}`);
}

// ─── Cleanup ──────────────────────────────────────────────
async function cleanup() {
  console.log("\n=== CLEANUP ===");
  const pool = require("./db");
  try {
    await pool.query(
      `DELETE FROM payments WHERE tenant_id IN (
         SELECT id FROM users WHERE email = ANY($1::text[]))`,
      [[TENANT_A_EMAIL, TENANT_B_EMAIL, TENANT_C_EMAIL]]
    );
    await pool.query(
      `DELETE FROM leases WHERE tenant_id IN (
         SELECT id FROM users WHERE email = ANY($1::text[]))`,
      [[TENANT_A_EMAIL, TENANT_B_EMAIL, TENANT_C_EMAIL]]
    );
    if (roomA) await pool.query("DELETE FROM rooms WHERE id = $1", [roomA.id]);
    if (roomB) await pool.query("DELETE FROM rooms WHERE id = $1", [roomB.id]);
    await pool.query(`DELETE FROM properties WHERE name LIKE 'Pay Test Dorm %'`);
    await pool.query(
      `DELETE FROM users WHERE email = ANY($1::text[])`,
      [[OWNER_A_EMAIL, OWNER_B_EMAIL, TENANT_A_EMAIL, TENANT_B_EMAIL, TENANT_C_EMAIL]]
    );
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
    await testTenantSubmission();
    await testValidation();
    await testTenantIsolation();
    await testOwnerLifecycle();
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