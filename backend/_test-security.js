/**
 * Security Integration Test — 12 Cases
 * Tests: cross-owner isolation, tenant browsing, role isolation, admin scope
 *
 * Requires: server running on :5000, DB seeded with at least the dev accounts.
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

// ─── Setup ────────────────────────────────────────────────
const ADMIN_EMAIL = `admin_security_${Date.now()}@test.com`;
const OWNER_A_EMAIL = `ownera_security_${Date.now()}@test.com`;
const OWNER_B_EMAIL = `ownerb_security_${Date.now()}@test.com`;
const TENANT_EMAIL = `tenant_security_${Date.now()}@test.com`;
const PW = "Test1234!";

let adminToken, ownerAToken, ownerBToken, tenantToken;
let ownerAId, ownerBId;
let propA, propB, roomA, roomB;

function loginToken(res) {
  return res?.json?.token ?? res?.json?.data?.token ?? null;
}

async function setup() {
  console.log("\n=== SETUP: Creating test users ===");
  const pool = require("./db");
  const bcrypt = require("bcryptjs");

  // Register Owner A
  let r = await req("POST", "/api/auth/register-owner", {
    name: "Owner A", email: OWNER_A_EMAIL, phone: "09111111111", password: PW,
  });
  assert("Owner A registered", r.status === 201, `status=${r.status}`);
  ownerAId = r.json?.data?.id;

  // Register Owner B
  r = await req("POST", "/api/auth/register-owner", {
    name: "Owner B", email: OWNER_B_EMAIL, phone: "09222222222", password: PW,
  });
  assert("Owner B registered", r.status === 201, `status=${r.status}`);
  ownerBId = r.json?.data?.id;

  // Seed a real tenant user (role=tenant) directly via DB, since the tenant
  // browse routes are gated with requireRole("tenant").
  const hash = await bcrypt.hash(PW, 12);
  await pool.query(
    `INSERT INTO users (name, email, phone, password_hash, role, status, email_verified)
     VALUES ($1, $2, $3, $4, 'tenant', 'active', true)`,
    ["Fake Tenant", TENANT_EMAIL, "09333333333", hash]
  );

  // Admin approves both owners (or activate via DB if the admin login is unavailable).
  r = await req("POST", "/api/auth/login", { email: "admin@pagdagusan.com", password: "Admin123!" });
  if (loginToken(r)) {
    adminToken = loginToken(r);
    console.log("  INFO  Logged in as existing admin");
  } else {
    console.log("  WARN  Could not login as admin, will approve owners via DB");
  }

  if (adminToken) {
    for (const id of [ownerAId, ownerBId]) {
      r = await req("PATCH", `/api/admin/owners/${id}/approve`, {}, adminToken);
      if (r.status !== 200) {
        await pool.query(`UPDATE users SET status = 'active' WHERE id = $1`, [id]);
      }
    }
  } else if (ownerAId) {
    await pool.query(`UPDATE users SET status = 'active' WHERE id IN ($1, $2)`, [ownerAId, ownerBId]);
  }

  // Login Owner A
  r = await req("POST", "/api/auth/login", { email: OWNER_A_EMAIL, password: PW });
  assert("Owner A logs in", r.status === 200, `status=${r.status}`);
  ownerAToken = loginToken(r);

  // Login Owner B
  r = await req("POST", "/api/auth/login", { email: OWNER_B_EMAIL, password: PW });
  assert("Owner B logs in", r.status === 200, `status=${r.status}`);
  ownerBToken = loginToken(r);

  // Login the real tenant for browse tests.
  r = await req("POST", "/api/auth/login", { email: TENANT_EMAIL, password: PW });
  assert("Tenant logs in", r.status === 200, `status=${r.status}`);
  tenantToken = loginToken(r);

  // Create property + room for Owner A
  r = await req("POST", "/api/owner/properties", {
    name: "Security Test Dorm A", address: "123 Test St A",
  }, ownerAToken);
  assert("Owner A creates property", r.status === 201, `status=${r.status}`);
  propA = r.json?.data;

  if (propA) {
    r = await req("POST", "/api/owner/rooms", {
      propertyId: propA.id, roomNumber: "SEC-101", monthlyRent: 5000, capacity: 2,
    }, ownerAToken);
    assert("Owner A creates room", r.status === 201, `status=${r.status}`);
    roomA = r.json?.data;
  }

  // Create property + room for Owner B
  r = await req("POST", "/api/owner/properties", {
    name: "Security Test Dorm B", address: "456 Test St B",
  }, ownerBToken);
  assert("Owner B creates property", r.status === 201, `status=${r.status}`);
  propB = r.json?.data;

  if (propB) {
    r = await req("POST", "/api/owner/rooms", {
      propertyId: propB.id, roomNumber: "SEC-201", monthlyRent: 6000, capacity: 1,
    }, ownerBToken);
    assert("Owner B creates room", r.status === 201, `status=${r.status}`);
    roomB = r.json?.data;
  }
}

// ─── Tests ────────────────────────────────────────────────
async function testCrossOwnerIsolation() {
  console.log("\n=== TEST: Cross-Owner Isolation ===");

  // Case 1: Owner B cannot view Owner A's property
  let r = await req("GET", `/api/owner/properties/${propA.id}`, null, ownerBToken);
  assert("Case 1: Owner B cannot view Owner A's property", r.status === 404, `status=${r.status}`);

  // Case 2: Owner B cannot update Owner A's property
  r = await req("PUT", `/api/owner/properties/${propA.id}`, {
    name: "HACKED", address: "HACKED",
  }, ownerBToken);
  assert("Case 2: Owner B cannot update Owner A's property", r.status === 404, `status=${r.status}`);

  // Case 3: Owner B cannot view Owner A's room
  if (roomA) {
    r = await req("GET", `/api/owner/rooms/${roomA.id}`, null, ownerBToken);
    assert("Case 3: Owner B cannot view Owner A's room", r.status === 404, `status=${r.status}`);
  }

  // Case 4: Owner B cannot update Owner A's room
  if (roomA) {
    r = await req("PUT", `/api/owner/rooms/${roomA.id}`, {
      roomNumber: "HACKED", monthlyRent: 4000, capacity: 2,
    }, ownerBToken);
    assert("Case 4: Owner B cannot update Owner A's room", r.status === 404, `status=${r.status}`);
  }

  // Case 5: Owner B cannot delete Owner A's room
  if (roomA) {
    r = await req("DELETE", `/api/owner/rooms/${roomA.id}`, null, ownerBToken);
    assert("Case 5: Owner B cannot delete Owner A's room", r.status === 404, `status=${r.status}`);
  }

  // Case 6: Owner A cannot view Owner B's property
  r = await req("GET", `/api/owner/properties/${propB.id}`, null, ownerAToken);
  assert("Case 6: Owner A cannot view Owner B's property", r.status === 404, `status=${r.status}`);
}

async function testTenantBrowsing() {
  console.log("\n=== TEST: Tenant Browsing ===");

  // Case 7: Authenticated tenant can browse active dorms
  let r = await req("GET", "/api/tenant/browse/dorms", null, tenantToken);
  assert("Case 7: Browse dorms returns 200", r.status === 200, `status=${r.status}`);
  assert("Case 7: Browse dorms returns array", Array.isArray(r.json?.data), `type=${typeof r.json?.data}`);

  // Case 8: Dorm detail shows rooms with amenities
  if (propA) {
    r = await req("GET", `/api/tenant/browse/dorms/${propA.id}`, null, tenantToken);
    assert("Case 8: Dorm detail returns 200", r.status === 200, `status=${r.status}`);
    // amenities should now be an array (not undefined)
    const dorm = r.json?.data;
    assert("Case 8: Dorm detail has amenities array", Array.isArray(dorm?.amenities), `amenities=${JSON.stringify(dorm?.amenities)}`);
    assert("Case 8: Dorm detail has rooms array", Array.isArray(dorm?.rooms), `rooms=${Array.isArray(dorm?.rooms)}`);
  }

  // Case 9: Room detail returns available room info
  if (roomA) {
    r = await req("GET", `/api/tenant/browse/rooms/${roomA.id}`, null, tenantToken);
    assert("Case 9: Room detail returns 200", r.status === 200, `status=${r.status}`);
    assert("Case 9: Room detail has monthlyRent", r.json?.data?.monthlyRent != null, `data=${JSON.stringify(r.json?.data)}`);
  }
}

async function testRoleIsolation() {
  console.log("\n=== TEST: Role Isolation ===");

  // Case 10: Owner cannot access admin endpoints
  let r = await req("GET", "/api/admin/owners", null, ownerAToken);
  assert("Case 10: Owner blocked from admin /owners", r.status === 403, `status=${r.status}`);

  r = await req("GET", "/api/admin/stats", null, ownerAToken);
  assert("Case 10: Owner blocked from admin /stats", r.status === 403, `status=${r.status}`);

  // Case 11: Unauthenticated requests are rejected from protected routes
  r = await req("GET", "/api/owner/properties");
  assert("Case 11: Unauthenticated → 401 on /owner/properties", r.status === 401, `status=${r.status}`);

  r = await req("GET", "/api/owner/rooms");
  assert("Case 11: Unauthenticated → 401 on /owner/rooms", r.status === 401, `status=${r.status}`);

  r = await req("GET", "/api/tenant/browse/dorms");
  assert("Case 11: Unauthenticated → 401 on /tenant/browse", r.status === 401, `status=${r.status}`);
}

async function testValidation() {
  console.log("\n=== TEST: Input Validation ===");

  // Case 12: Room creation rejects duplicate room_number within same property
  if (propA) {
    let r = await req("POST", "/api/owner/rooms", {
      propertyId: propA.id, roomNumber: "SEC-101", monthlyRent: 4000,
    }, ownerAToken);
    assert("Case 12: Duplicate room_number → 409", r.status === 409, `status=${r.status}`);

    // Capacity < 1 is rejected
    r = await req("POST", "/api/owner/rooms", {
      propertyId: propA.id, roomNumber: "SEC-NEW", monthlyRent: 4000, capacity: 0,
    }, ownerAToken);
    assert("Case 12: Capacity 0 → 400", r.status === 400, `status=${r.status}`);

    // Negative rent is rejected
    r = await req("POST", "/api/owner/rooms", {
      propertyId: propA.id, roomNumber: "SEC-NEW", monthlyRent: -100,
    }, ownerAToken);
    assert("Case 12: Negative rent → 400", r.status === 400, `status=${r.status}`);
  }
}

// ─── Cleanup ──────────────────────────────────────────────
async function cleanup() {
  console.log("\n=== CLEANUP ===");
  const pool = require("./db");

  try {
    // Delete rooms first (cascade is limited)
    if (roomA) await pool.query("DELETE FROM rooms WHERE id = $1", [roomA.id]);
    if (roomB) await pool.query("DELETE FROM rooms WHERE id = $1", [roomB.id]);
    // Delete properties
    if (propA) await pool.query("DELETE FROM properties WHERE id = $1", [propA.id]);
    if (propB) await pool.query("DELETE FROM properties WHERE id = $1", [propB.id]);
    // Delete users
    await pool.query("DELETE FROM users WHERE email IN ($1, $2, $3, $4)", [
      ADMIN_EMAIL, OWNER_A_EMAIL, OWNER_B_EMAIL, TENANT_EMAIL,
    ]);
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
    await testCrossOwnerIsolation();
    await testTenantBrowsing();
    await testRoleIsolation();
    await testValidation();
  } catch (err) {
    console.error("\nFATAL:", err);
    failed++;
  } finally {
    await cleanup();
  }

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
})();
