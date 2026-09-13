/**
 * Maintenance module integration/security test.
 * Covers: tenant submission, validation, lease gating, tenant editing/cancelling,
 * owner status workflow (pending → reviewing → in_progress → completed), owner notes,
 * tenant + owner isolation, role isolation (403), unauthenticated (401).
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
const OWNER_A_EMAIL = `maint_ownera_${TS}@test.com`;
const OWNER_B_EMAIL = `maint_ownerb_${TS}@test.com`;
const TENANT_A_EMAIL = `maint_tenanta_${TS}@test.com`;
const TENANT_B_EMAIL = `maint_tenantb_${TS}@test.com`;
const TENANT_C_EMAIL = `maint_tenantc_${TS}@test.com`;
const PW = "Test1234!";

let ownerAToken, ownerBToken, tenantAToken, tenantBToken, tenantCToken, adminToken;
let roomA1, roomA2, roomB1;
let reqMain, reqEdit, reqCancel, reqOwnerCancel, reqReviewCancel;

async function activateOwners(...ids) {
  const pool = require("./db");
  await pool.query(`UPDATE users SET status = 'active' WHERE id = ANY($1::uuid[])`, [ids]);
}

// ─── Setup ────────────────────────────────────────────────
async function setup() {
  console.log("\n=== SETUP ===");
  const pool = require("./db");

  let r = await req("POST", "/api/auth/register-owner", {
    name: "Maint Owner A", email: OWNER_A_EMAIL, phone: "09123456791", password: PW,
  });
  assert("Owner A registered", r.status === 201, `status=${r.status}`);
  const ownerAId = r.json?.data?.id;

  r = await req("POST", "/api/auth/register-owner", {
    name: "Maint Owner B", email: OWNER_B_EMAIL, phone: "09123456792", password: PW,
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

  const propA = (await req("POST", "/api/owner/properties", {
    name: "Maint Test Dorm A", address: "1 Maint St A",
  }, ownerAToken)).json?.data;

  if (propA) {
    roomA1 = (await req("POST", "/api/owner/rooms", {
      propertyId: propA.id, roomNumber: "MNT-A1", monthlyRent: 5000, capacity: 3,
    }, ownerAToken)).json?.data;
    roomA2 = (await req("POST", "/api/owner/rooms", {
      propertyId: propA.id, roomNumber: "MNT-A2", monthlyRent: 5000, capacity: 3,
    }, ownerAToken)).json?.data;
  }

  const propB = (await req("POST", "/api/owner/properties", {
    name: "Maint Test Dorm B", address: "2 Maint St B",
  }, ownerBToken)).json?.data;
  if (propB) {
    roomB1 = (await req("POST", "/api/owner/rooms", {
      propertyId: propB.id, roomNumber: "MNT-B1", monthlyRent: 6000, capacity: 3,
    }, ownerBToken)).json?.data;
  }

  // Tenant A on Owner A room1, Tenant B on Owner A room2 (cross-tenant isolation),
  // Tenant C with no lease (lease-gating 409).
  let t = await req("POST", "/api/owner/tenants", {
    name: "Maint Tenant A", email: TENANT_A_EMAIL, phone: "09123456793", password: PW, roomId: roomA1?.id,
  }, ownerAToken);
  assert("Tenant A created with active lease", t.status === 201 && t.json?.data?.leaseId, `status=${t.status}`);
  t = await req("POST", "/api/auth/login", { email: TENANT_A_EMAIL, password: PW });
  assert("Tenant A logs in", t.status === 200, `status=${t.status}`);
  tenantAToken = loginToken(t);

  t = await req("POST", "/api/owner/tenants", {
    name: "Maint Tenant B", email: TENANT_B_EMAIL, phone: "09123456794", password: PW, roomId: roomA2?.id,
  }, ownerAToken);
  assert("Tenant B created with active lease", t.status === 201 && t.json?.data?.leaseId, `status=${t.status}`);
  t = await req("POST", "/api/auth/login", { email: TENANT_B_EMAIL, password: PW });
  assert("Tenant B logs in", t.status === 200, `status=${t.status}`);
  tenantBToken = loginToken(t);

  t = await req("POST", "/api/owner/tenants", {
    name: "Maint Tenant C", email: TENANT_C_EMAIL, phone: "09123456795", password: PW,
  }, ownerAToken);
  assert("Tenant C created without lease", t.status === 201, `status=${t.status}`);
  t = await req("POST", "/api/auth/login", { email: TENANT_C_EMAIL, password: PW });
  assert("Tenant C logs in", t.status === 200, `status=${t.status}`);
  tenantCToken = loginToken(t);

  // Admin for role-isolation check
  r = await req("POST", "/api/auth/login", { email: "admin@pagdagusan.com", password: "Admin123!" });
  adminToken = loginToken(r);
  if (adminToken) console.log("  INFO  Admin token acquired");
  else console.log("  WARN  Admin login unavailable, skipping admin assertions");
}

// ─── Tenant submission & validation ──────────────────────
async function testTenantSubmission() {
  console.log("\n=== TEST: Tenant Submission ===");

  let r = await req("POST", "/api/tenant/maintenance", {
    title: "Leaking faucet",
    description: "The bathroom faucet leaks constantly.",
  }, tenantAToken);
  assert("Create request (defaults) → 201", r.status === 201, `status=${r.status}`);
  assert("Default category = general", r.json?.data?.category === "general", `cat=${r.json?.data?.category}`);
  assert("Default priority = medium", r.json?.data?.priority === "medium", `prio=${r.json?.data?.priority}`);
  assert("Default status = pending", r.json?.data?.status === "pending", `st=${r.json?.data?.status}`);
  assert("Detail has roomNumber", !!r.json?.data?.roomNumber, `room=${r.json?.data?.roomNumber}`);
  assert("Detail has propertyName", !!r.json?.data?.propertyName, `prop=${r.json?.data?.propertyName}`);
  reqMain = r.json?.data;

  r = await req("POST", "/api/tenant/maintenance", {
    title: "Broken AC",
    description: "Aircon no longer blows cold air.",
    category: "appliance",
    priority: "urgent",
    imageUrl: "https://example.com/ac.jpg",
  }, tenantAToken);
  assert("Create request (custom) → 201", r.status === 201, `status=${r.status}`);
  assert("Custom category applied", r.json?.data?.category === "appliance", `cat=${r.json?.data?.category}`);
  assert("Custom priority applied", r.json?.data?.priority === "urgent", `prio=${r.json?.data?.priority}`);
  assert("Image URL stored", r.json?.data?.imageUrl === "https://example.com/ac.jpg");
  reqEdit = r.json?.data;

  console.log("\n=== TEST: Tenant Validation ===");
  r = await req("POST", "/api/tenant/maintenance", { title: "", description: "x" }, tenantAToken);
  assert("Missing title → 400", r.status === 400, `status=${r.status}`);

  r = await req("POST", "/api/tenant/maintenance", { title: "T", description: "" }, tenantAToken);
  assert("Missing description → 400", r.status === 400, `status=${r.status}`);

  r = await req("POST", "/api/tenant/maintenance", { title: "T", description: "x", category: "nope" }, tenantAToken);
  assert("Invalid category → 400", r.status === 400, `status=${r.status}`);

  r = await req("POST", "/api/tenant/maintenance", { title: "T", description: "x", priority: "extreme" }, tenantAToken);
  assert("Invalid priority → 400", r.status === 400, `status=${r.status}`);

  r = await req("POST", "/api/tenant/maintenance", { title: "T", description: "x", imageUrl: "not-a-url" }, tenantAToken);
  assert("Invalid imageUrl → 400", r.status === 400, `status=${r.status}`);

  r = await req("POST", "/api/tenant/maintenance", {
    title: "No lease", description: "This tenant has no active lease",
  }, tenantCToken);
  assert("No active lease → 409", r.status === 409, `status=${r.status}`);
}

// ─── Tenant list/detail + isolation ───────────────────────
async function testTenantListDetail() {
  console.log("\n=== TEST: Tenant List & Detail ===");

  let r = await req("GET", "/api/tenant/maintenance", null, tenantAToken);
  assert("Tenant A list → 200", r.status === 200, `status=${r.status}`);
  assert("Tenant A sees their requests", Array.isArray(r.json?.data) && r.json.data.length === 2, `len=${r.json?.data?.length}`);

  r = await req("GET", "/api/tenant/maintenance?status=pending", null, tenantAToken);
  assert("Filter pending returns requests", r.json?.data?.length >= 2, `len=${r.json?.data?.length}`);
  r = await req("GET", "/api/tenant/maintenance?status=completed", null, tenantAToken);
  assert("Filter completed returns none", r.json?.data?.length === 0, `len=${r.json?.data?.length}`);

  r = await req("GET", `/api/tenant/maintenance/${reqMain.id}`, null, tenantAToken);
  assert("Tenant A detail → 200", r.status === 200, `status=${r.status}`);
  assert("Detail category present", r.json?.data?.category === "general");
  assert("Detail roomId/propertyId present", !!r.json?.data?.roomId && !!r.json?.data?.propertyId);

  r = await req("GET", `/api/tenant/maintenance/${reqMain.id}`, null, tenantBToken);
  assert("Tenant B sees Tenant A's request → 404", r.status === 404, `status=${r.status}`);

  r = await req("GET", "/api/tenant/maintenance/00000000-0000-0000-0000-000000000000", null, tenantAToken);
  assert("Nonexistent request → 404", r.status === 404, `status=${r.status}`);
}

// ─── Tenant edit & cancel ─────────────────────────────────
async function testTenantEditCancel() {
  console.log("\n=== TEST: Tenant Edit & Cancel ===");

  let r = await req("PATCH", `/api/tenant/maintenance/${reqEdit.id}`, {
    title: "Broken AC (updated)",
    category: "electrical",
    priority: "high",
  }, tenantAToken);
  assert("Tenant edits own pending → 200", r.status === 200, `status=${r.status}`);
  assert("Title updated", r.json?.data?.title === "Broken AC (updated)", `title=${r.json?.data?.title}`);
  assert("Category updated", r.json?.data?.category === "electrical", `cat=${r.json?.data?.category}`);
  assert("Priority updated", r.json?.data?.priority === "high", `prio=${r.json?.data?.priority}`);

  r = await req("PATCH", `/api/tenant/maintenance/${reqMain.id}`, {
    title: "Should not change",
  }, tenantBToken);
  assert("Tenant B edits Tenant A's request → 404", r.status === 404, `status=${r.status}`);

  r = await req("PATCH", `/api/tenant/maintenance/${reqEdit.id}`, {
    title: "T", description: "x", category: "bad",
  }, tenantAToken);
  assert("Edit with invalid category → 400", r.status === 400, `status=${r.status}`);

  // Cancel while pending → allowed, terminal.
  r = await req("POST", "/api/tenant/maintenance", {
    title: "Temp issue", description: "Will cancel right away",
  }, tenantAToken);
  assert("Create cancellable request → 201", r.status === 201, `status=${r.status}`);
  reqCancel = r.json?.data;
  r = await req("PATCH", `/api/tenant/maintenance/${reqCancel.id}/cancel`, null, tenantAToken);
  assert("Tenant cancels own pending → 200", r.status === 200, `status=${r.status}`);
  assert("Status is cancelled", r.json?.data?.status === "cancelled", `st=${r.json?.data?.status}`);

  r = await req("PATCH", `/api/tenant/maintenance/${reqCancel.id}/cancel`, null, tenantAToken);
  assert("Cancel again → 409", r.status === 409, `status=${r.status}`);

  r = await req("PATCH", `/api/tenant/maintenance/${reqCancel.id}`, { title: "X" }, tenantAToken);
  assert("Edit cancelled request → 409", r.status === 409, `status=${r.status}`);

  // Tenant may also cancel while the request is being reviewed.
  r = await req("POST", "/api/tenant/maintenance", {
    title: "Cancel while reviewing", description: "Owner started review, tenant withdraws",
  }, tenantAToken);
  assert("Create request for reviewing-cancel → 201", r.status === 201, `status=${r.status}`);
  reqReviewCancel = r.json?.data;
  r = await req("PATCH", `/api/owner/maintenance/${reqReviewCancel.id}/status`, { status: "reviewing" }, ownerAToken);
  assert("Owner moves to reviewing → 200", r.status === 200, `status=${r.status}`);
  r = await req("PATCH", `/api/tenant/maintenance/${reqReviewCancel.id}/cancel`, null, tenantAToken);
  assert("Tenant cancels own reviewing → 200", r.status === 200, `status=${r.status}`);
  assert("Status is cancelled", r.json?.data?.status === "cancelled", `st=${r.json?.data?.status}`);
}

// ─── Owner workflow ───────────────────────────────────────
async function testOwnerWorkflow() {
  console.log("\n=== TEST: Owner Workflow ===");

  let r = await req("GET", "/api/owner/maintenance", null, ownerBToken);
  assert("Owner B list → 200", r.status === 200, `status=${r.status}`);
  assert("Owner B does not see Owner A's requests", r.json?.data?.length === 0, `len=${r.json?.data?.length}`);

  r = await req("GET", "/api/owner/maintenance", null, ownerAToken);
  assert("Owner A list has requests", r.json?.data?.length >= 2, `len=${r.json?.data?.length}`);
  const item = r.json.data.find((x) => x.id === reqMain.id);
  assert("List has tenant email/phone", !!item?.tenantEmail && !!item?.tenantPhone, `email=${item?.tenantEmail}`);
  assert("List has category", item?.category === "general", `cat=${item?.category}`);

  r = await req("GET", `/api/owner/maintenance/${reqMain.id}`, null, ownerBToken);
  assert("Owner B detail of Owner A's request → 404", r.status === 404, `status=${r.status}`);

  r = await req("GET", `/api/owner/maintenance/${reqMain.id}`, null, ownerAToken);
  assert("Owner A detail → 200", r.status === 200, `status=${r.status}`);
  assert("Detail has tenant + property info", !!r.json?.data?.tenantEmail && !!r.json?.data?.propertyAddress, `prop=${r.json?.data?.propertyAddress}`);
  assert("Detail has floor", "floor" in r.json?.data);

  // Status: invalid value → 400
  r = await req("PATCH", `/api/owner/maintenance/${reqMain.id}/status`, { status: "nonsense" }, ownerAToken);
  assert("Invalid status → 400", r.status === 400, `status=${r.status}`);

  // Skip transitions are blocked: a request cannot jump from pending straight
  // to in_progress/completed. Used on a fresh pending request so the current-
  // status precondition is accurate.
  r = await req("POST", "/api/tenant/maintenance", {
    title: "Skip test", description: "Testing skip transitions",
  }, tenantAToken);
  assert("Create request for skip test → 201", r.status === 201, `status=${r.status}`);
  const reqSkip = r.json?.data;
  r = await req("PATCH", `/api/owner/maintenance/${reqSkip.id}/status`, { status: "in_progress" }, ownerAToken);
  assert("pending → in_progress (skip) blocked 409", r.status === 409, `status=${r.status}`);
  r = await req("PATCH", `/api/owner/maintenance/${reqSkip.id}/status`, { status: "completed" }, ownerAToken);
  assert("pending → completed (skip) blocked 409", r.status === 409, `status=${r.status}`);
  r = await req("PATCH", `/api/owner/maintenance/${reqSkip.id}/status`, { status: "cancelled" }, ownerAToken);
  assert("pending → cancelled allowed → 200", r.status === 200 && r.json?.data?.status === "cancelled", `status=${r.status}`);

  // pending → reviewing
  r = await req("PATCH", `/api/owner/maintenance/${reqMain.id}/status`, { status: "reviewing" }, ownerAToken);
  assert("pending → reviewing → 200", r.status === 200 && r.json?.data?.status === "reviewing", `status=${r.status}`);

  // reviewing → in_progress
  r = await req("PATCH", `/api/owner/maintenance/${reqMain.id}/status`, { status: "in_progress" }, ownerAToken);
  assert("reviewing → in_progress → 200", r.status === 200 && r.json?.data?.status === "in_progress", `status=${r.status}`);

  // tenant can't edit once out of pending
  r = await req("PATCH", `/api/tenant/maintenance/${reqMain.id}`, { title: "Too late" }, tenantAToken);
  assert("Tenant edits non-pending → 409", r.status === 409, `status=${r.status}`);

  // owner notes on a request
  r = await req("PATCH", `/api/owner/maintenance/${reqMain.id}/notes`, { ownerNotes: "Scheduling plumber for Thursday 2PM." }, ownerAToken);
  assert("Owner adds notes → 200", r.status === 200 && r.json?.data?.ownerNotes, `status=${r.status}`);

  r = await req("PATCH", `/api/owner/maintenance/${reqMain.id}/notes`, { ownerNotes: "x".repeat(3000) }, ownerAToken);
  assert("Overlong notes → 400", r.status === 400, `status=${r.status}`);

  r = await req("PATCH", `/api/owner/maintenance/${reqMain.id}/notes`, { ownerNotes: "Rescheduled to Friday." }, ownerBToken);
  assert("Owner B notes on Owner A's request → 404", r.status === 404, `status=${r.status}`);

  // in_progress → completed
  r = await req("PATCH", `/api/owner/maintenance/${reqMain.id}/status`, { status: "completed" }, ownerAToken);
  assert("in_progress → completed → 200", r.status === 200 && r.json?.data?.status === "completed", `status=${r.status}`);

  r = await req("GET", `/api/owner/maintenance/${reqMain.id}`, null, ownerAToken);
  assert("completedAt set", !!r.json?.data?.completedAt, `at=${r.json?.data?.completedAt}`);
  assert("Notes persisted (rejected overlong/403-like writes ignored)",
    r.json?.data?.ownerNotes === "Scheduling plumber for Thursday 2PM.",
    `notes=${r.json?.data?.ownerNotes}`);

  // terminal blocked
  r = await req("PATCH", `/api/owner/maintenance/${reqMain.id}/status`, { status: "cancelled" }, ownerAToken);
  assert("completed → cancelled blocked 409", r.status === 409, `status=${r.status}`);

  // owner cancel from reviewing
  r = await req("POST", "/api/tenant/maintenance", {
    title: "Owner will cancel", description: "Duplicate ticket",
  }, tenantAToken);
  assert("Create request for owner-cancel → 201", r.status === 201, `status=${r.status}`);
  reqOwnerCancel = r.json?.data;
  r = await req("PATCH", `/api/owner/maintenance/${reqOwnerCancel.id}/status`, { status: "reviewing" }, ownerAToken);
  assert("Move to reviewing → 200", r.status === 200, `status=${r.status}`);
  r = await req("PATCH", `/api/owner/maintenance/${reqOwnerCancel.id}/status`, { status: "cancelled" }, ownerAToken);
  assert("Owner cancels reviewing → 200", r.status === 200 && r.json?.data?.status === "cancelled", `status=${r.status}`);

  // Tenant sees final statuses
  r = await req("GET", "/api/tenant/maintenance", null, tenantAToken);
  const completed = r.json?.data?.find((x) => x.id === reqMain.id);
  const cancelled = r.json?.data?.find((x) => x.id === reqOwnerCancel.id);
  assert("Tenant sees completed status", completed?.status === "completed", `st=${completed?.status}`);
  assert("Tenant sees cancelled status", cancelled?.status === "cancelled", `st=${cancelled?.status}`);
  assert("Tenant sees owner notes", completed?.ownerNotes === "Scheduling plumber for Thursday 2PM.", `notes=${completed?.ownerNotes}`);
}

// ─── Role isolation ───────────────────────────────────────
async function testRoleIsolation() {
  console.log("\n=== TEST: Role Isolation ===");

  let r = await req("GET", "/api/owner/maintenance", null, tenantAToken);
  assert("Tenant on owner endpoint → 403", r.status === 403, `status=${r.status}`);

  r = await req("POST", "/api/owner/maintenance/00000000-0000-0000-0000-000000000000/status", { status: "completed" }, tenantAToken);
  assert("Tenant posts owner status → 403", r.status === 403, `status=${r.status}`);

  r = await req("GET", "/api/tenant/maintenance", null, ownerAToken);
  assert("Owner on tenant endpoint → 403", r.status === 403, `status=${r.status}`);

  r = await req("GET", "/api/owner/maintenance", null, null);
  assert("Unauthenticated owner endpoint → 401", r.status === 401, `status=${r.status}`);

  r = await req("POST", "/api/tenant/maintenance", { title: "Admin", description: "x" }, adminToken);
  assert("Admin cannot submit maintenance → 403", r.status === 403, `status=${r.status}`);

  r = await req("GET", "/api/owner/maintenance", null, adminToken);
  assert("Admin cannot access owner maintenance → 403", r.status === 403, `status=${r.status}`);
}

// ─── Cleanup ──────────────────────────────────────────────
async function cleanup() {
  console.log("\n=== CLEANUP ===");
  const pool = require("./db");
  try {
    await pool.query(
      `DELETE FROM maintenance_requests WHERE tenant_id IN (
         SELECT id FROM users WHERE email = ANY($1::text[]))`,
      [[TENANT_A_EMAIL, TENANT_B_EMAIL, TENANT_C_EMAIL]]
    );
    await pool.query(
      `DELETE FROM leases WHERE tenant_id IN (
         SELECT id FROM users WHERE email = ANY($1::text[]))`,
      [[TENANT_A_EMAIL, TENANT_B_EMAIL, TENANT_C_EMAIL]]
    );
    if (roomA1) await pool.query("DELETE FROM rooms WHERE id = $1", [roomA1.id]);
    if (roomA2) await pool.query("DELETE FROM rooms WHERE id = $1", [roomA2.id]);
    if (roomB1) await pool.query("DELETE FROM rooms WHERE id = $1", [roomB1.id]);
    await pool.query(`DELETE FROM properties WHERE name LIKE 'Maint Test Dorm %'`);
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
    await testTenantListDetail();
    await testTenantEditCancel();
    await testOwnerWorkflow();
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