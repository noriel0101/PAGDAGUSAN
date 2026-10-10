/**
 * Capstone Tenant Flow Test — Multi-Owner Applications
 *
 * Mirrors the capstone FINAL TEST:
 *  1. A tenant can apply to DIFFERENT dorm owners (multiple pending applications).
 *  2. Each owner only sees applications for their OWN property.
 *  3. Approving one application creates an active lease.
 *  4. A tenant can NEVER hold two active leases at the same time.
 *
 * Requires: server running on :5000.
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

const POOL = require("./db");
const bcrypt = require("bcryptjs");
const PW = "Test1234!";
const OWNER_A = `multi_owner_a_${Date.now()}@test.com`;
const OWNER_B = `multi_owner_b_${Date.now()}@test.com`;
const TENANT = `multi_tenant_${Date.now()}@test.com`;

let adminToken;
let ownerAToken, ownerBToken, tenantToken;
let ownerAId, ownerBId;
let propA, propB, roomA1, roomB1;
let appA, appB;

async function approveOwnerDirect(ownerId) {
  if (adminToken && ownerId) {
    const r = await req("PATCH", `/api/admin/owners/${ownerId}/approve`, {}, adminToken);
    if (r.status === 200) return;
  }
  await POOL.query(`UPDATE users SET status = 'active' WHERE id = $1`, [ownerId]);
}

async function setup() {
  console.log("\n=== SETUP ===");

  let r = await req("POST", "/api/auth/login", { email: "admin@pagdagusan.com", password: "Admin123!" });
  adminToken = loginToken(r);
  console.log(adminToken ? "  INFO  Admin logged in" : "  WARN  Admin login failed — using DB approval");

  // Owner A
  r = await req("POST", "/api/auth/register-owner", { name: "Multi Owner A", email: OWNER_A, phone: "09100000001", password: PW });
  ownerAId = r.json?.data?.id;
  await approveOwnerDirect(ownerAId);
  r = await req("POST", "/api/auth/login", { email: OWNER_A, password: PW });
  ownerAToken = loginToken(r);

  // Owner B
  r = await req("POST", "/api/auth/register-owner", { name: "Multi Owner B", email: OWNER_B, phone: "09100000002", password: PW });
  ownerBId = r.json?.data?.id;
  await approveOwnerDirect(ownerBId);
  r = await req("POST", "/api/auth/login", { email: OWNER_B, password: PW });
  ownerBToken = loginToken(r);

  // Tenant
  const hash = await bcrypt.hash(PW, 12);
  await POOL.query(
    `INSERT INTO users (name, email, phone, password_hash, role, status, email_verified)
     VALUES ($1, $2, $3, $4, 'tenant', 'active', true)`,
    ["Multi Tenant", TENANT, "09200000009", hash]
  );
  r = await req("POST", "/api/auth/login", { email: TENANT, password: PW });
  tenantToken = loginToken(r);

  // Property + room for Owner A
  if (ownerAToken) {
    r = await req("POST", "/api/owner/properties", { name: "Maria's Dormitory", address: "10 Owner A Street", contactNumber: "09110000000" }, ownerAToken);
    propA = r.json?.data;
    if (propA) {
      r = await req("POST", "/api/owner/rooms", { propertyId: propA.id, roomNumber: "A-101", monthlyRent: 5000, capacity: 2 }, ownerAToken);
      roomA1 = r.json?.data;
    }
  }

  // Property + room for Owner B
  if (ownerBToken) {
    r = await req("POST", "/api/owner/properties", { name: "Juan's Dormitory", address: "20 Owner B Street", contactNumber: "09120000000" }, ownerBToken);
    propB = r.json?.data;
    if (propB) {
      r = await req("POST", "/api/owner/rooms", { propertyId: propB.id, roomNumber: "B-203", monthlyRent: 6000, capacity: 2 }, ownerBToken);
      roomB1 = r.json?.data;
    }
  }

  assert("Owner A creates room A-101", !!roomA1, "missing roomA1");
  assert("Owner B creates room B-203", !!roomB1, "missing roomB1");
}

async function testBrowseListsDifferentOwners() {
  console.log("\n=== CASE 1: Browse shows different dorm owners ===");
  const r = await req("GET", "/api/tenant/browse/dorms", null, tenantToken);
  assert("Browse dorms returns 200", r.status === 200, `status=${r.status}`);
  const list = r.json?.data ?? [];
  const names = list.map((d) => d.ownerName);
  assert("Both owners appear in browse list", names.includes("Multi Owner A") && names.includes("Multi Owner B"), JSON.stringify(names));
}

async function testApplyToOwnerA() {
  console.log("\n=== CASE 2: Apply to Owner A ===");
  const r = await req("POST", "/api/tenant/reservations", {
    room_id: roomA1.id,
    move_in_date: "2026-11-01",
    message: "Application to Owner A",
  }, tenantToken);
  assert("Application #1 created", r.status === 201, `status=${r.status} msg=${r.json?.message}`);
  appA = r.json?.data;
  assert("Application #1 is pending_approval", appA?.status === "pending_approval", `status=${appA?.status}`);
}

async function testApplyToOwnerB() {
  console.log("\n=== CASE 3: Apply to Owner B (DIFFERENT owner) __ KEY CAPSTONE REQUIREMENT __");
  const r = await req("POST", "/api/tenant/reservations", {
    room_id: roomB1.id,
    move_in_date: "2026-12-01",
    message: "Application to Owner B",
  }, tenantToken);
  assert("Application #2 created (multiple pending allowed)", r.status === 201, `status=${r.status} msg=${r.json?.message}`);
  appB = r.json?.data;
  assert("Application #2 is pending_approval", appB?.status === "pending_approval", `status=${appB?.status}`);
}

async function testTenantSeesBothApplications() {
  console.log("\n=== CASE 4: Tenant sees both applications separately ===");
  const r = await req("GET", "/api/tenant/reservations", null, tenantToken);
  assert("Reservations list returns 200", r.status === 200, `status=${r.status}`);
  const items = r.json?.data ?? [];
  assert("Exactly 2 applications", items.length === 2, `count=${items.length}`);
  const ids = items.map((x) => x.id);
  assert("Application #1 (Owner A) listed", ids.includes(appA.id), JSON.stringify(ids));
  assert("Application #2 (Owner B) listed", ids.includes(appB.id), JSON.stringify(ids));
  const a = items.find((x) => x.id === appA.id);
  const b = items.find((x) => x.id === appB.id);
  assert("App #1 shows Owner A name", a?.ownerName === "Multi Owner A", `owner=${a?.ownerName}`);
  assert("App #2 shows Owner B name", b?.ownerName === "Multi Owner B", `owner=${b?.ownerName}`);
}

async function testOwnerScoping() {
  console.log("\n=== CASE 5: Owner isolation (A sees only A, B sees only B) ===");
  const a = await req("GET", "/api/owner/reservations", null, ownerAToken);
  const aIds = a.json?.data?.map((x) => x.id) ?? [];
  assert("Owner A sees Application #1", aIds.includes(appA.id), JSON.stringify(aIds));
  assert("Owner A does NOT see Application #2", !aIds.includes(appB.id), JSON.stringify(aIds));

  const b = await req("GET", "/api/owner/reservations", null, ownerBToken);
  const bIds = b.json?.data?.map((x) => x.id) ?? [];
  assert("Owner B sees Application #2", bIds.includes(appB.id), JSON.stringify(bIds));
  assert("Owner B does NOT see Application #1", !bIds.includes(appA.id), JSON.stringify(bIds));
}

async function testApproveOwnerA() {
  console.log("\n=== CASE 6: Owner A approves Application #1 ===");
  const r = await req("POST", `/api/owner/reservations/${appA.id}/approve`, {}, ownerAToken);
  assert("Approve returns 200", r.status === 200, `status=${r.status} msg=${r.json?.message}`);
  assert("Approve sets active", r.json?.data?.status === "active", `status=${r.json?.data?.status}`);

  const t = await req("GET", `/api/tenant/reservations/${appA.id}`, null, tenantToken);
  assert("Tenant sees Application #1 as active", t.json?.data?.status === "active", `status=${t.json?.data?.status}`);
}

async function testOwnerBCannotCreateSecondActiveLease() {
  console.log("\n=== CASE 7: Owner B CANNOT approve while tenant already active ===");
  const r = await req("POST", `/api/owner/reservations/${appB.id}/approve`, {}, ownerBToken);
  assert("Owner B approval blocked (409, active lease exists)", r.status === 409, `status=${r.status} msg=${r.json?.message}`);

  const t = await req("GET", `/api/tenant/reservations/${appB.id}`, null, tenantToken);
  assert("Tenant Application #2 remains pending_approval", t.json?.data?.status === "pending_approval", `status=${t.json?.data?.status}`);
}

async function testTenantCannotApplyWhileActiveLease() {
  console.log("\n=== CASE 8: Tenant cannot apply for more rooms while active lease exists ===");
  const r = await req("POST", "/api/tenant/reservations", { room_id: roomB1.id }, tenantToken);
  assert("New application blocked (409)", r.status === 409, `status=${r.status} msg=${r.json?.message}`);
}

async function testSecurity() {
  console.log("\n=== CASE 9: Security (owner cannot access tenant endpoints) ===");
  const r = await req("GET", "/api/tenant/reservations", null, ownerAToken);
  assert("Owner cannot read tenant reservations (403)", r.status === 403, `status=${r.status}`);
  const r2 = await req("GET", "/api/owner/reservations", null, tenantToken);
  assert("Tenant cannot read owner reservations (403)", r2.status === 403, `status=${r2.status}`);
}

async function cleanup() {
  console.log("\n=== CLEANUP ===");
  try {
    await POOL.query("DELETE FROM leases WHERE room_id = ANY($1::uuid[])", [[roomA1?.id, roomB1?.id].filter(Boolean)]);
    await POOL.query("DELETE FROM rooms WHERE id = ANY($1::uuid[])", [[roomA1?.id, roomB1?.id].filter(Boolean)]);
    await POOL.query("DELETE FROM properties WHERE id = ANY($1::uuid[])", [[propA?.id, propB?.id].filter(Boolean)]);
    await POOL.query("DELETE FROM users WHERE email IN ($1, $2, $3)", [OWNER_A, OWNER_B, TENANT]);
    console.log("  Done — test data removed");
  } catch (e) {
    console.error("  Cleanup error:", e.message);
  } finally {
    await POOL.end();
  }
}

(async () => {
  try {
    await setup();
    await testBrowseListsDifferentOwners();
    await testApplyToOwnerA();
    await testApplyToOwnerB();
    await testTenantSeesBothApplications();
    await testOwnerScoping();
    await testApproveOwnerA();
    await testOwnerBCannotCreateSecondActiveLease();
    await testTenantCannotApplyWhileActiveLease();
    await testSecurity();
  } catch (err) {
    console.error("\nFATAL:", err);
    failed++;
  } finally {
    await cleanup();
  }

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
})();