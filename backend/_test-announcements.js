/**
 * Announcements module integration/security test.
 * Covers: owner create/list/detail/edit, property-ownership enforcement on POST,
 * publish/archive lifecycle + published_at, tenant feed scoping (published only,
 * property + owner scoped, newest first), cross-owner/cross-property isolation,
 * DELETE, role isolation (403) and unauthenticated (401).
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
const OWNER_A_EMAIL = `annc_ownera_${TS}@test.com`;
const OWNER_B_EMAIL = `annc_ownerb_${TS}@test.com`;
const TENANT_A_EMAIL = `annc_tenanta_${TS}@test.com`;
const TENANT_B_EMAIL = `annc_tenantb_${TS}@test.com`;
const PW = "Test1234!";

let ownerAToken, ownerBToken, tenantAToken, tenantBToken, adminToken;
let propA1, propA2, propB1, roomA1, roomA2;
let anncDraftA1, anncDraftA2, anncDraftHidden, anncPublishedB;

async function activateOwners(...ids) {
  const pool = require("./db");
  await pool.query(`UPDATE users SET status = 'active' WHERE id = ANY($1::uuid[])`, [ids]);
}

// ─── Setup ────────────────────────────────────────────────
async function setup() {
  console.log("\n=== SETUP ===");
  const pool = require("./db");

  let r = await req("POST", "/api/auth/register-owner", {
    name: "Annc Owner A", email: OWNER_A_EMAIL, phone: "09123456801", password: PW,
  });
  assert("Owner A registered", r.status === 201, `status=${r.status}`);
  const ownerAId = r.json?.data?.id;

  r = await req("POST", "/api/auth/register-owner", {
    name: "Annc Owner B", email: OWNER_B_EMAIL, phone: "09123456802", password: PW,
  });
  assert("Owner B registered", r.status === 201, `status=${r.status}`);
  const ownerBId = r.json?.data?.id;

  await activateOwners(ownerAId, ownerBId);

  r = await req("POST", "/api/auth/login", { email: OWNER_A_EMAIL, password: PW });
  ownerAToken = loginToken(r);
  assert("Owner A logs in", !!ownerAToken, `status=${r.status}`);

  r = await req("POST", "/api/auth/login", { email: OWNER_B_EMAIL, password: PW });
  ownerBToken = loginToken(r);
  assert("Owner B logs in", !!ownerBToken, `status=${r.status}`);

  propA1 = (await req("POST", "/api/owner/properties", {
    name: "Annc Test Dorm A1", address: "1 Annc St A",
  }, ownerAToken)).json?.data;
  propB1 = (await req("POST", "/api/owner/properties", {
    name: "Annc Test Dorm B", address: "3 Annc St B",
  }, ownerBToken)).json?.data;
  assert("Owner A has one property", !!propA1, `a1=${!!propA1}`);
  assert("Owner B has one property", !!propB1, `b1=${!!propB1}`);

  if (propA1) {
    roomA1 = (await req("POST", "/api/owner/rooms", {
      propertyId: propA1.id, roomNumber: "ANN-A1", monthlyRent: 5000, capacity: 3,
    }, ownerAToken)).json?.data;
    roomA2 = (await req("POST", "/api/owner/rooms", {
      propertyId: propA1.id, roomNumber: "ANN-A2", monthlyRent: 5000, capacity: 3,
    }, ownerAToken)).json?.data;
  }
  assert("Rooms created", !!roomA1 && !!roomA2, `a1=${!!roomA1} a2=${!!roomA2}`);

  let t = await req("POST", "/api/owner/tenants", {
    name: "Annc Tenant A", email: TENANT_A_EMAIL, phone: "09123456803", password: PW, roomId: roomA1?.id,
  }, ownerAToken);
  assert("Tenant A created with active lease", t.status === 201 && t.json?.data?.leaseId, `status=${t.status}`);
  t = await req("POST", "/api/auth/login", { email: TENANT_A_EMAIL, password: PW });
  tenantAToken = loginToken(t);
  assert("Tenant A logs in", !!tenantAToken, `status=${t.status}`);

  t = await req("POST", "/api/owner/tenants", {
    name: "Annc Tenant B", email: TENANT_B_EMAIL, phone: "09123456804", password: PW, roomId: roomA2?.id,
  }, ownerAToken);
  assert("Tenant B created with active lease", t.status === 201 && t.json?.data?.leaseId, `status=${t.status}`);
  t = await req("POST", "/api/auth/login", { email: TENANT_B_EMAIL, password: PW });
  tenantBToken = loginToken(t);
  assert("Tenant B logs in", !!tenantBToken, `status=${t.status}`);

  r = await req("POST", "/api/auth/login", { email: "admin@pagdagusan.com", password: "Admin123!" });
  adminToken = loginToken(r);
  if (adminToken) console.log("  INFO  Admin token acquired");
  else console.log("  WARN  Admin login unavailable, skipping admin assertions");
}

// ─── TEST: Owner creates announcements ────────────────────
async function testOwnerCreate() {
  console.log("\n=== TEST: Owner Create ===");

  let r = await req("POST", "/api/owner/announcements", {
    title: "Rooms for rent", content: "Sign-in required this Friday.",
  }, ownerAToken);
  assert("Create without propertyId → 201 draft on own first property",
    r.status === 201 && r.json?.data?.status === "draft" && r.json?.data?.propertyId === propA1?.id,
    `status=${r.status} prop=${r.json?.data?.propertyId ?? "none"} st=${r.json?.data?.status}`);
  anncDraftA1 = r.json?.data;

  r = await req("POST", "/api/owner/announcements", {
    title: "Water service", content: "Water will be off tomorrow morning.",
    propertyId: propA1?.id,
  }, ownerAToken);
  assert("Create with own propertyId → 201 on that property",
    r.status === 201 && r.json?.data?.propertyId === propA1?.id,
    `status=${r.status} prop=${r.json?.data?.propertyId ?? "none"}`);
  anncDraftA2 = r.json?.data;

  r = await req("POST", "/api/owner/announcements", {
    title: "Secret draft", content: "Must never reach tenants",
  }, ownerAToken);
  assert("Create draft for isolation → 201", r.status === 201, `status=${r.status}`);
  anncDraftHidden = r.json?.data;

  r = await req("POST", "/api/owner/announcements", {
    title: "Sneaky", content: "Try to post to someone else's dorm",
    propertyId: propB1?.id,
  }, ownerAToken);
  assert("Create with another owner's property → 403", r.status === 403, `status=${r.status}`);

  r = await req("POST", "/api/owner/announcements", {
    title: "Ghost", content: "No such property",
    propertyId: "00000000-0000-0000-0000-000000000000",
  }, ownerAToken);
  assert("Create with non-existent property → 403", r.status === 403, `status=${r.status}`);

  r = await req("POST", "/api/owner/announcements", { title: "", content: "x" }, ownerAToken);
  assert("Create missing title → 400", r.status === 400, `status=${r.status}`);

  r = await req("POST", "/api/owner/announcements", { title: "T", content: "  " }, ownerAToken);
  assert("Create empty content → 400", r.status === 400, `status=${r.status}`);

  r = await req("POST", "/api/owner/announcements", { title: "T", content: "x", propertyId: propA1?.id, owner_id: "anything" }, ownerAToken);
  assert("owner_id in body is ignored (creates on own account)",
    r.status === 201 && r.json?.data?.propertyId === propA1?.id, `status=${r.status}`);

  r = await req("POST", "/api/owner/announcements", { title: "T".repeat(201), content: "x" }, ownerAToken);
  assert("Overlong title → 400", r.status === 400, `status=${r.status}`);
}

// ─── TEST: Owner list and detail ──────────────────────────
async function testOwnerListDetail() {
  console.log("\n=== TEST: Owner List / Detail ===");

  let r = await req("GET", "/api/owner/announcements", null, ownerAToken);
  const mine = r.json?.data || [];
  assert("Owner A lists all own announcements (any status)",
    r.status === 200 && mine.length >= 3, `status=${r.status} n=${mine.length}`);
  assert("List includes drafts", mine.some((a) => a.status === "draft"), "no draft found");
  assert("List includes propertyName",
    mine.some((a) => a.propertyName === "Annc Test Dorm A1"), `names=${JSON.stringify(mine.map((a) => a.propertyName))}`);

  r = await req("GET", `/api/owner/announcements/${anncDraftA1?.id}`, null, ownerAToken);
  assert("Owner detail own announcement → 200", r.status === 200 && r.json?.data?.id === anncDraftA1?.id, `status=${r.status}`);

  r = await req("GET", `/api/owner/announcements/${anncDraftA1?.id}`, null, ownerBToken);
  assert("Owner B cannot see Owner A's announcement → 404", r.status === 404, `status=${r.status}`);

  r = await req("GET", "/api/owner/announcements/00000000-0000-0000-0000-000000000000", null, ownerAToken);
  assert("Detail non-existent → 404", r.status === 404, `status=${r.status}`);
}

// ─── TEST: Owner edits ────────────────────────────────────
async function testOwnerEdit() {
  console.log("\n=== TEST: Owner Edit (PUT) ===");

  let r = await req("PUT", `/api/owner/announcements/${anncDraftA1?.id}`, {
    title: "Rooms for rent (updated)", content: "Sign-in at the front desk this Friday night.",
  }, ownerAToken);
  assert("Edit own announcement → 200", r.status === 200 && r.json?.data?.title === "Rooms for rent (updated)", `status=${r.status}`);
  assert("Edit keeps draft status", r.json?.data?.status === "draft", `st=${r.json?.data?.status}`);
  assert("Edit keeps property", r.json?.data?.propertyId === propA1?.id, `prop=${r.json?.data?.propertyId}`);

  r = await req("PUT", `/api/owner/announcements/${anncDraftA1?.id}`, {
    title: "Still mine", content: "Body", owner_id: "00000000-0000-0000-0000-000000000099",
  }, ownerAToken);
  assert("owner_id tampering ignored on edit", r.status === 200, `status=${r.status}`);
  r = await req("GET", `/api/owner/announcements/${anncDraftA1?.id}`, null, ownerBToken);
  assert("Ownership unchanged after tampering → 404 for Owner B", r.status === 404, `status=${r.status}`);

  r = await req("PUT", `/api/owner/announcements/${anncDraftA1?.id}`, {
    title: "Tamper", content: "Try to change status", status: "published", propertyId: propB1?.id,
  }, ownerAToken);
  assert("status/propertyId ignored on edit → 200", r.status === 200 && r.json?.data?.status === "draft", `status=${r.status} st=${r.json?.data?.status}`);

  r = await req("PUT", `/api/owner/announcements/${anncDraftA2?.id}`, { title: "no content" }, ownerAToken);
  assert("Edit missing content → 400", r.status === 400, `status=${r.status}`);

  r = await req("PUT", `/api/owner/announcements/${anncDraftA1?.id}`, { title: "x", content: "y" }, ownerBToken);
  assert("Owner B cannot edit Owner A's → 404", r.status === 404, `status=${r.status}`);
}

// ─── TEST: Publish / Archive lifecycle ────────────────────
async function testLifecycle() {
  console.log("\n=== TEST: Publish / Archive Lifecycle ===");

  let r = await req("PATCH", `/api/owner/announcements/${anncDraftA1?.id}/publish`, {}, ownerAToken);
  assert("Publish draft → 200 published", r.status === 200 && r.json?.data?.status === "published", `status=${r.status} st=${r.json?.data?.status}`);
  assert("publishedAt set on publish", !!r.json?.data?.publishedAt, `at=${r.json?.data?.publishedAt}`);

  r = await req("PATCH", `/api/owner/announcements/${anncDraftA1?.id}/publish`, {}, ownerAToken);
  assert("Publish already published → 200 idempotent", r.status === 200 && r.json?.data?.status === "published", `status=${r.status}`);

  r = await req("PATCH", `/api/owner/announcements/${anncDraftA2?.id}/archive`, {}, ownerAToken);
  assert("Archive draft → 200 archived", r.status === 200 && r.json?.data?.status === "archived", `status=${r.status} st=${r.json?.data?.status}`);

  r = await req("PATCH", `/api/owner/announcements/${anncDraftA2?.id}/archive`, {}, ownerAToken);
  assert("Archive already archived → 200 idempotent", r.status === 200 && r.json?.data?.status === "archived", `status=${r.status}`);

  r = await req("PATCH", `/api/owner/announcements/${anncDraftA2?.id}/publish`, {}, ownerAToken);
  assert("Re-publish archived → 200 published", r.status === 200 && r.json?.data?.status === "published", `status=${r.status} st=${r.json?.data?.status}`);

  // Owner B publishes to his own property for cross-owner scoping.
  r = await req("POST", "/api/owner/announcements", {
    title: "Only for dorm B", content: "Owner B tenant note", propertyId: propB1?.id,
  }, ownerBToken);
  assert("Owner B creates draft → 201", r.status === 201, `status=${r.status}`);
  anncPublishedB = r.json?.data;
  r = await req("PATCH", `/api/owner/announcements/${anncPublishedB.id}/publish`, {}, ownerBToken);
  assert("Owner B publishes → 200", r.status === 200 && r.json?.data?.status === "published", `status=${r.status}`);

  r = await req("PATCH", `/api/owner/announcements/${anncDraftA1?.id}/archive`, {}, ownerBToken);
  assert("Owner B cannot archive Owner A's → 404", r.status === 404, `status=${r.status}`);

  r = await req("PATCH", "/api/owner/announcements/00000000-0000-0000-0000-000000000000/publish", {}, ownerAToken);
  assert("Publish non-existent → 404", r.status === 404, `status=${r.status}`);
}

// ─── TEST: Tenant feed scoping ────────────────────────────
async function testTenantFeed() {
  console.log("\n=== TEST: Tenant Announcements Feed ===");

  // Tenant A is on propA1; published announcement anncDraftA1 is propA1-scoped.
  // anncDraftHidden stays a draft → must not appear. anncPublishedB belongs to Owner B.
  let r = await req("GET", "/api/tenant/announcements", null, tenantAToken);
  const feed = r.json?.data || [];
  assert("Tenant feed only published", r.status === 200 && feed.every((a) => a.status === "published"), `status=${r.status}`);
  assert("Tenant A sees own property announcement", feed.some((a) => a.id === anncDraftA1?.id), "missing propA1 announcement");
  assert("Tenant A does NOT see hidden draft", !feed.some((a) => a.id === anncDraftHidden?.id), "leaked draft announcement");
  assert("Tenant A does NOT see Owner B's announcement", !feed.some((a) => a.id === anncPublishedB?.id), "leaked other owner announcement");
  assert("Tenant feed shows ownerName", feed.some((a) => a.id === anncDraftA1?.id && a.ownerName === "Annc Owner A"), "no ownerName");
  assert("Tenant feed shows propertyName", feed.some((a) => a.id === anncDraftA1?.id && a.propertyName === "Annc Test Dorm A1"), "no propertyName");
  assert("Tenant feed sorted published_at DESC",
    feed.length >= 2 &&
    new Date(feed[0].publishedAt).getTime() >= new Date(feed[1].publishedAt).getTime(),
    `first=${feed[0]?.publishedAt} second=${feed[1]?.publishedAt}`);

  r = await req("GET", `/api/tenant/announcements/${anncDraftA1?.id}`, null, tenantAToken);
  assert("Tenant detail own property published → 200", r.status === 200 && !!r.json?.data?.ownerName, `status=${r.status}`);
  r.json?.data;

  r = await req("GET", `/api/tenant/announcements/${anncDraftHidden?.id}`, null, tenantAToken);
  assert("Tenant detail hidden draft → 404", r.status === 404, `status=${r.status}`);

  r = await req("GET", `/api/tenant/announcements/${anncPublishedB?.id}`, null, tenantAToken);
  assert("Tenant detail other owner → 404", r.status === 404, `status=${r.status}`);

  // Tenant B on another room of the same dorm also sees it.
  r = await req("GET", "/api/tenant/announcements", null, tenantBToken);
  const feedB = r.json?.data || [];
  assert("Tenant B sees same property announcement", feedB.some((a) => a.id === anncDraftA1?.id), "missing for tenant B");
}

// ─── TEST: DELETE ─────────────────────────────────────────
async function testDelete() {
  console.log("\n=== TEST: DELETE ===");

  let r = await req("DELETE", `/api/owner/announcements/${anncDraftA2?.id}`, null, ownerAToken);
  assert("Delete own announcement → 200", r.status === 200, `status=${r.status}`);

  r = await req("DELETE", `/api/owner/announcements/${anncDraftA2?.id}`, null, ownerAToken);
  assert("Delete already deleted → 404", r.status === 404, `status=${r.status}`);

  r = await req("DELETE", `/api/owner/announcements/${anncDraftA1?.id}`, null, ownerBToken);
  assert("Owner B cannot delete Owner A's → 404", r.status === 404, `status=${r.status}`);

  r = await req("DELETE", `/api/owner/announcements/00000000-0000-0000-0000-000000000000`, null, ownerAToken);
  assert("Delete non-existent → 404", r.status === 404, `status=${r.status}`);
}

// ─── TEST: Role isolation ─────────────────────────────────
async function testRoleIsolation() {
  console.log("\n=== TEST: Role Isolation ===");

  let r = await req("GET", "/api/owner/announcements", null, tenantAToken);
  assert("Tenant on owner endpoint → 403", r.status === 403, `status=${r.status}`);

  r = await req("POST", "/api/owner/announcements", { title: "T", content: "x" }, tenantAToken);
  assert("Tenant creates owner announcement → 403", r.status === 403, `status=${r.status}`);

  r = await req("DELETE", `/api/owner/announcements/${anncDraftA1?.id}`, null, tenantAToken);
  assert("Tenant deletes announcement → 403", r.status === 403, `status=${r.status}`);

  r = await req("GET", "/api/tenant/announcements", null, ownerAToken);
  assert("Owner on tenant endpoint → 403", r.status === 403, `status=${r.status}`);

  r = await req("GET", "/api/owner/announcements", null, null);
  assert("Unauthenticated owner endpoint → 401", r.status === 401, `status=${r.status}`);

  if (adminToken) {
    r = await req("GET", "/api/owner/announcements", null, adminToken);
    assert("Admin cannot access owner announcements → 403", r.status === 403, `status=${r.status}`);

    r = await req("POST", "/api/owner/announcements", { title: "T", content: "x" }, adminToken);
    assert("Admin cannot create owner announcement → 403", r.status === 403, `status=${r.status}`);
  }
}

// ─── Cleanup ──────────────────────────────────────────────
async function cleanup() {
  console.log("\n=== CLEANUP ===");
  const pool = require("./db");
  try {
    await pool.query(
      `DELETE FROM announcements WHERE owner_id IN (
         SELECT id FROM users WHERE email = ANY($1::text[]))`,
      [[OWNER_A_EMAIL, OWNER_B_EMAIL]]
    );
    await pool.query(
      `DELETE FROM leases WHERE tenant_id IN (
         SELECT id FROM users WHERE email = ANY($1::text[]))`,
      [[TENANT_A_EMAIL, TENANT_B_EMAIL]]
    );
    if (roomA1) await pool.query("DELETE FROM rooms WHERE id = $1", [roomA1.id]);
    if (roomA2) await pool.query("DELETE FROM rooms WHERE id = $1", [roomA2.id]);
    await pool.query(`DELETE FROM properties WHERE name LIKE 'Annc Test Dorm %'`);
    await pool.query(
      `DELETE FROM users WHERE email = ANY($1::text[])`,
      [[OWNER_A_EMAIL, OWNER_B_EMAIL, TENANT_A_EMAIL, TENANT_B_EMAIL]]
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
    await testOwnerCreate();
    await testOwnerListDetail();
    await testOwnerEdit();
    await testLifecycle();
    await testTenantFeed();
    await testDelete();
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