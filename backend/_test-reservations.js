/**
 * Reservation Workflow Integration Test — 16 Cases
 * Covers: happy path reservation, approval, rejection, cancellation,
 *         double-apply blocking, tenant-owned-resource check, mobile fallback naming.
 *
 * Requires: server running on :5000 with at least the admin@pagdagusan.com account.
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
const OWNER_EMAIL  = `res_owner_${Date.now()}@test.com`;
const TENANT1_EMAIL = `res_tenant1_${Date.now()}@test.com`;
const TENANT2_EMAIL = `res_tenant2_${Date.now()}@test.com`;
const PW = "Test1234!";

let adminToken, ownerToken, tenant1Token, tenant2Token;
let ownerId;
let property, room;
let reservationId;
let reservationIdT2;

function loginToken(res) {
  return res?.json?.token ?? res?.json?.data?.token ?? null;
}

async function setup() {
  console.log("\n=== SETUP ===");
  const pool = require("./db");
  const bcrypt = require("bcryptjs");

  // Admin login (best-effort; omitted accounts approve via DB fallback below)
  let r = await req("POST", "/api/auth/login", { email: "admin@pagdagusan.com", password: "Admin123!" });
  if (loginToken(r)) {
    adminToken = loginToken(r);
    console.log("  INFO  Admin logged in");
  } else {
    console.log("  WARN  Admin login failed — approving owner via DB");
  }

  // Register + approve owner
  r = await req("POST", "/api/auth/register-owner", {
    name: "Res Test Owner", email: OWNER_EMAIL, phone: "09100000001", password: PW,
  });
  assert("Owner registered", r.status === 201, `status=${r.status}`);
  ownerId = r.json?.data?.id;

  if (adminToken && ownerId) {
    r = await req("PATCH", `/api/admin/owners/${ownerId}/approve`, {}, adminToken);
    if (r.status !== 200) {
      console.log(`  WARN  Admin approve endpoint returned ${r.status} — falling back to DB`);
    }
  }

  if (!ownerId || r?.status !== 200) {
    await pool.query(`UPDATE users SET status = 'active' WHERE id = $1`, [ownerId]);
    console.log("  INFO  Owner approved via DB");
  }

  r = await req("POST", "/api/auth/login", { email: OWNER_EMAIL, password: PW });
  assert("Owner logs in", r.status === 200, `status=${r.status}`);
  ownerToken = loginToken(r);

  // Create property + room (capacity=2 so both tenants can apply in the happy path)
  r = await req("POST", "/api/owner/properties", {
    name: "Res Test Dorm", address: "100 Test Ave", contactNumber: "09170000000",
  }, ownerToken);
  assert("Owner creates property", r.status === 201, `status=${r.status}`);
  property = r.json?.data;

  if (property) {
    r = await req("POST", "/api/owner/rooms", {
      propertyId: property.id, roomNumber: "T-101", monthlyRent: 5500, capacity: 2,
    }, ownerToken);
    assert("Owner creates room (capacity 2)", r.status === 201, `status=${r.status}`);
    room = r.json?.data;
  }

  // Seed two tenant users directly via DB
  const hash = await bcrypt.hash(PW, 12);

  await pool.query(
    `INSERT INTO users (name, email, phone, password_hash, role, status, email_verified)
     VALUES ($1, $2, $3, $4, 'tenant', 'active', true)`,
    ["Res Test Tenant 1", TENANT1_EMAIL, "09200000001", hash]
  );
  r = await req("POST", "/api/auth/login", { email: TENANT1_EMAIL, password: PW });
  assert("Tenant 1 logs in", r.status === 200, `status=${r.status}`);
  tenant1Token = loginToken(r);

  await pool.query(
    `INSERT INTO users (name, email, phone, password_hash, role, status, email_verified)
     VALUES ($1, $2, $3, $4, 'tenant', 'active', true)`,
    ["Res Test Tenant 2", TENANT2_EMAIL, "09300000002", hash]
  );
  r = await req("POST", "/api/auth/login", { email: TENANT2_EMAIL, password: PW });
  assert("Tenant 2 logs in", r.status === 200, `status=${r.status}`);
  tenant2Token = loginToken(r);
}

// ─── Tests ────────────────────────────────────────────────

// Case 1: Tenant submits reservation → pending_approval
async function testHappyPathReservation() {
  console.log("\n=== CASE 1: Happy Path Reservation ===");
  const r = await req("POST", "/api/tenant/reservations", {
    room_id: room.id,
    move_in_date: "2026-10-01",
    message: "Looking forward to moving in",
  }, tenant1Token);
  assert("Tenant 1 reservation created", r.status === 201, `status=${r.status} msg=${r.json?.message}`);
  reservationId = r.json?.data?.id;
  assert("Status is pending_approval", r.json?.data?.status === "pending_approval", `status=${r.json?.data?.status}`);
}

// Case 2: Reservation includes computed fields in GET
async function testReservationListIncludesComputedFields() {
  console.log("\n=== CASE 2: GET /reservations returns computed fields ===");
  const r = await req("GET", "/api/tenant/reservations", null, tenant1Token);
  assert("Tenant reservation list returns 200", r.status === 200, `status=${r.status}`);
  const item = r.json?.data?.find((x) => x.id === reservationId);
  assert("Item has roomNumber", item?.roomNumber === "T-101", `roomNumber=${item?.roomNumber}`);
  assert("Item has capacity", item?.capacity === 2, `capacity=${item?.capacity}`);
  assert("Item has currentOccupancy", typeof item?.currentOccupancy === "number", `currentOccupancy=${item?.currentOccupancy}`);
  assert("Item has ownerName", typeof item?.ownerName === "string" && item.ownerName.length > 0, `ownerName=${item?.ownerName}`);
  assert("Item has propertyAddress", typeof item?.propertyAddress === "string", `propertyAddress=${item?.propertyAddress}`);
}

// Case 3: Tenant GET /reservations/:id works for own reservation
async function testReservationDetailOwn() {
  console.log("\n=== CASE 3: GET /reservations/:id (own) ===");
  const r = await req("GET", `/api/tenant/reservations/${reservationId}`, null, tenant1Token);
  assert("Own reservation detail returns 200", r.status === 200, `status=${r.status}`);
  assert("Detail has propertyContact", typeof r.json?.data?.propertyContact === "string", `propertyContact=${r.json?.data?.propertyContact}`);
}

// Case 4: second tenant can also apply (capacity 2) and uses backward-compat naming;
// owner of a reservation cannot be another tenant.
async function testReservationDetailForbidden() {
  console.log("\n=== CASE 4: Second application + wrong-tenant isolation ===");
  // tenant2 uses the legacy/mobile field names (roomId, startDate, notes)
  const r = await req("POST", "/api/tenant/reservations", {
    roomId: room.id,
    startDate: "2026-11-01",
    notes: "Backward compatible naming",
  }, tenant2Token);
  assert("Tenant 2 reservation created (capacity allows 2)", r.status === 201, `status=${r.status} msg=${r.json?.message}`);
  reservationIdT2 = r.json?.data?.id;
  assert("Status is pending_approval", r.json?.data?.status === "pending_approval", `status=${r.json?.data?.status}`);

  const r2 = await req("GET", `/api/tenant/reservations/${reservationIdT2}`, null, tenant1Token);
  assert("Tenant 1 cannot see Tenant 2's reservation", r2.status === 404, `status=${r2.status}`);
}

// Case 5: A tenant may only hold one application/lease at a time → 409
async function testDoubleApplyRejected() {
  console.log("\n=== CASE 5: Tenant double-apply returns 409 ===");
  const r = await req("POST", "/api/tenant/reservations", {
    room_id: room.id,
  }, tenant1Token);
  assert("Second application by Tenant 1 → 409", r.status === 409, `status=${r.status} msg=${r.json?.message}`);
}

// Case 6: Owner sees both reservations via GET /reservations
async function testOwnerReservationList() {
  console.log("\n=== CASE 6: Owner reservation list ===");
  const r = await req("GET", "/api/owner/reservations", null, ownerToken);
  assert("Owner reservation list returns 200", r.status === 200, `status=${r.status}`);
  const ids = r.json?.data?.map((x) => x.id) ?? [];
  assert("List includes Tenant 1's reservation", ids.includes(reservationId), `ids=${JSON.stringify(ids)}`);
  assert("List includes Tenant 2's reservation", ids.includes(reservationIdT2), `ids=${JSON.stringify(ids)}`);
}

// Case 7: Owner GET /reservations/:id works
async function testOwnerReservationDetail() {
  console.log("\n=== CASE 7: Owner reservation detail ===");
  const r = await req("GET", `/api/owner/reservations/${reservationId}`, null, ownerToken);
  assert("Owner reservation detail returns 200", r.status === 200, `status=${r.status}`);
  assert("Detail has tenantName", r.json?.data?.tenantName === "Res Test Tenant 1", `tenantName=${r.json?.data?.tenantName}`);
}

// Case 8: Owner cannot view reservation from another property (own-scoped)
// (Not applicable here since both are same owner, but we test invalid ID)
async function testOwnerReservationDetailNotFound() {
  console.log("\n=== CASE 8: Owner reservation detail — invalid ID ===");
  const r = await req("GET", "/api/owner/reservations/00000000-0000-0000-0000-000000000000", null, ownerToken);
  assert("Invalid reservation ID returns 404", r.status === 404, `status=${r.status}`);
}

// Case 9: Owner POST /reservations/:id/approve → lease becomes active, room occupancy increases
async function testApproveReservation() {
  console.log("\n=== CASE 9: Approve reservation ===");
  const r = await req("POST", `/api/owner/reservations/${reservationId}/approve`, {}, ownerToken);
  assert("Approve returns 200", r.status === 200, `status=${r.status}`);
  assert("Approved status is active", r.json?.data?.status === "active", `status=${r.json?.data?.status}`);

  // Verify tenant's reservation is now active
  const r2 = await req("GET", `/api/tenant/reservations/${reservationId}`, null, tenant1Token);
  assert("Tenant sees status=active", r2.json?.data?.status === "active", `status=${r2.json?.data?.status}`);
}

// Case 10: After approval, conflicting reservation for same room is cancelled
async function testConflictingReservationCancelled() {
  console.log("\n=== CASE 10: Conflicting reservation auto-cancelled ===");
  const r = await req("GET", `/api/tenant/reservations/${reservationIdT2}`, null, tenant2Token);
  assert("Tenant 2's reservation status is cancelled", r.json?.data?.status === "cancelled", `status=${r.json?.data?.status}`);
}

// Case 11: Owner POST /reservations/:id/approve on already processed reservation → 409
async function testDoubleApproveRejected() {
  console.log("\n=== CASE 11: Double-approve returns 409 ===");
  const r = await req("POST", `/api/owner/reservations/${reservationId}/approve`, {}, ownerToken);
  assert("Double approve returns 409", r.status === 409, `status=${r.status}`);
}

// Case 12: Owner POST /reservations/:id/reject on pending reservation
async function testRejectReservation() {
  console.log("\n=== CASE 12: Reject reservation ===");
  // Tenant 2's old reservation was auto-cancelled; a fresh application succeeds now
  // (occupancy = 1 active / 2 capacity).
  const cr = await req("POST", "/api/tenant/reservations", {
    roomId: room.id,
  }, tenant2Token);
  assert("Tenant 2 new reservation created", cr.status === 201, `status=${cr.status} msg=${cr.json?.message}`);
  const newId = cr.json?.data?.id;
  if (!newId) return;

  const r = await req("POST", `/api/owner/reservations/${newId}/reject`, {
    reason: "Room reserved for maintenance",
  }, ownerToken);
  assert("Reject returns 200", r.status === 200, `status=${r.status}`);
  assert("Rejected status is rejected", r.json?.data?.status === "rejected", `status=${r.json?.data?.status}`);

  const r2 = await req("GET", `/api/tenant/reservations/${newId}`, null, tenant2Token);
  assert("Tenant sees rejectionReason", r2.json?.data?.rejectionReason === "Room reserved for maintenance", `reason=${r2.json?.data?.rejectionReason}`);
}

// Case 13: Tenant DELETE /reservations/:id — cancel a pending reservation
async function testCancelReservation() {
  console.log("\n=== CASE 13: Cancel pending reservation ===");
  // Create a new tenant user for this test
  const pool = require("./db");
  const bcrypt = require("bcryptjs");
  const TENANT3_EMAIL = `res_tenant3_${Date.now()}@test.com`;
  const hash = await bcrypt.hash(PW, 12);
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role, status, email_verified)
     VALUES ($1, $2, $3, 'tenant', 'active', true)`,
    ["Res Test Tenant 3", TENANT3_EMAIL, hash]
  );

  const r = await req("POST", "/api/auth/login", { email: TENANT3_EMAIL, password: PW });
  const token3 = loginToken(r);

  const cr = await req("POST", "/api/tenant/reservations", { roomId: room.id }, token3);
  assert("Tenant 3 reservation created", cr.status === 201, `status=${cr.status}`);
  const id = cr.json?.data?.id;

  const dr = await req("DELETE", `/api/tenant/reservations/${id}`, null, token3);
  assert("Tenant 3 cancel returns 200", dr.status === 200, `status=${dr.status}`);
  assert("Cancelled status", dr.json?.data?.status === "cancelled", `status=${dr.json?.data?.status}`);

  const gr = await req("GET", `/api/tenant/reservations/${id}`, null, token3);
  assert("Tenant 3 sees cancelled status", gr.json?.data?.status === "cancelled", `status=${gr.json?.data?.status}`);
}

// Case 14: Cannot cancel an already approved reservation
async function testCannotCancelApproved() {
  console.log("\n=== CASE 14: Cannot cancel approved reservation ===");
  const r = await req("DELETE", `/api/tenant/reservations/${reservationId}`, null, tenant1Token);
  assert("Cancel approved reservation returns 409", r.status === 409, `status=${r.status}`);
}

// Case 15: Unauthenticated → 401 on reservation endpoints
async function testUnauthReservation() {
  console.log("\n=== CASE 15: Unauthenticated reservation calls → 401 ===");
  let r = await req("POST", "/api/tenant/reservations", { roomId: room?.id });
  assert("POST /reservations → 401 unauth", r.status === 401, `status=${r.status}`);

  r = await req("GET", "/api/tenant/reservations");
  assert("GET /reservations → 401 unauth", r.status === 401, `status=${r.status}`);

  r = await req("DELETE", `/api/tenant/reservations/00000000-0000-0000-0000-000000000000`);
  assert("DELETE /reservations → 401 unauth", r.status === 401, `status=${r.status}`);
}

// Case 16: Move-in date with invalid format → 400
async function testInvalidDateFormat() {
  console.log("\n=== CASE 16: Invalid move-in date format ===");
  const r = await req("POST", "/api/tenant/reservations", {
    roomId: room?.id,
    move_in_date: "10-01-2026",
  }, tenant1Token);
  assert("Invalid date format → 400", r.status === 400, `status=${r.status}`);
}

// ─── Cleanup ──────────────────────────────────────────────
async function cleanup() {
  console.log("\n=== CLEANUP ===");
  const pool = require("./db");

  try {
    if (room) await pool.query("DELETE FROM leases WHERE room_id = $1", [room.id]);
    if (room) await pool.query("DELETE FROM rooms WHERE id = $1", [room.id]);
    if (property) await pool.query("DELETE FROM properties WHERE id = $1", [property.id]);
    await pool.query("DELETE FROM users WHERE email IN ($1, $2, $3)", [
      OWNER_EMAIL, TENANT1_EMAIL, TENANT2_EMAIL,
    ]);
    // Also clean up tenant3 created inline
    await pool.query("DELETE FROM users WHERE name LIKE 'Res Test Tenant 3%'");
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
    await testHappyPathReservation();
    await testReservationListIncludesComputedFields();
    await testReservationDetailOwn();
    await testReservationDetailForbidden();
    await testDoubleApplyRejected();
    await testOwnerReservationList();
    await testOwnerReservationDetail();
    await testOwnerReservationDetailNotFound();
    await testApproveReservation();
    await testConflictingReservationCancelled();
    await testDoubleApproveRejected();
    await testRejectReservation();
    await testCancelReservation();
    await testCannotCancelApproved();
    await testUnauthReservation();
    await testInvalidDateFormat();
  } catch (err) {
    console.error("\nFATAL:", err);
    failed++;
  } finally {
    await cleanup();
  }

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
})();
