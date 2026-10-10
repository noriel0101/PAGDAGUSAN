/**
 * Ratings integration test
 *
 * Covers: owner↔tenant ratings, lease eligibility, role isolation,
 * upsert, notifications, and browse ranking by five-star count.
 *
 * Requires: server running on :5000 with admin@pagdagusan.com.
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
const STAMP = Date.now();
const PW = "Test1234!";
const ADMIN_EMAIL = "admin@pagdagusan.com";
const OWNER_A = `rate_owner_a_${STAMP}@test.com`;
const OWNER_B = `rate_owner_b_${STAMP}@test.com`;
const TENANT_1 = `rate_tenant_1_${STAMP}@test.com`;
const TENANT_2 = `rate_tenant_2_${STAMP}@test.com`;
const TENANT_3 = `rate_tenant_3_${STAMP}@test.com`;

let adminToken;
let ownerAToken, ownerBToken, tenant1Token, tenant2Token, tenant3Token;
let ownerAId, ownerBId, tenant1Id, tenant2Id, tenant3Id;
let propA, propB, roomA1, roomA2, roomB1;

async function approveOwnerDirect(ownerId) {
  if (adminToken && ownerId) {
    const r = await req("PATCH", `/api/admin/owners/${ownerId}/approve`, {}, adminToken);
    if (r.status === 200) return;
  }
  await POOL.query(`UPDATE users SET status = 'active' WHERE id = $1`, [ownerId]);
}

async function createTenant(name, email) {
  const hash = await bcrypt.hash(PW, 12);
  const inserted = await POOL.query(
    `INSERT INTO users (name, email, phone, password_hash, role, status, email_verified)
     VALUES ($1, $2, $3, $4, 'tenant', 'active', true)
     RETURNING id`,
    [name, email, "09170000000", hash]
  );
  const login = await req("POST", "/api/auth/login", { email, password: PW });
  return { id: inserted.rows[0].id, token: loginToken(login) };
}

async function setup() {
  console.log("\n=== SETUP ===");
  let r = await req("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: "Admin123!" });
  adminToken = loginToken(r);
  assert("Admin logs in", !!adminToken, `status=${r.status}`);

  r = await req("POST", "/api/auth/register-owner", {
    name: "Rate Owner A", email: OWNER_A, phone: "09110000001", password: PW,
  });
  ownerAId = r.json?.data?.id;
  await approveOwnerDirect(ownerAId);
  r = await req("POST", "/api/auth/login", { email: OWNER_A, password: PW });
  ownerAToken = loginToken(r);

  r = await req("POST", "/api/auth/register-owner", {
    name: "Rate Owner B", email: OWNER_B, phone: "09110000002", password: PW,
  });
  ownerBId = r.json?.data?.id;
  await approveOwnerDirect(ownerBId);
  r = await req("POST", "/api/auth/login", { email: OWNER_B, password: PW });
  ownerBToken = loginToken(r);

  const t1 = await createTenant("Rate Tenant 1", TENANT_1);
  const t2 = await createTenant("Rate Tenant 2", TENANT_2);
  const t3 = await createTenant("Rate Tenant 3", TENANT_3);
  tenant1Id = t1.id; tenant1Token = t1.token;
  tenant2Id = t2.id; tenant2Token = t2.token;
  tenant3Id = t3.id; tenant3Token = t3.token;
  assert("Test users ready", !!(ownerAToken && ownerBToken && tenant1Token && tenant2Token && tenant3Token));

  r = await req("POST", "/api/owner/properties", { name: "Alpha Dorm", address: "1 Alpha St", contactNumber: "09110000001" }, ownerAToken);
  propA = r.json?.data;
  r = await req("POST", "/api/owner/rooms", { propertyId: propA.id, roomNumber: "A-1", monthlyRent: 4000, capacity: 1 }, ownerAToken);
  roomA1 = r.json?.data;
  r = await req("POST", "/api/owner/rooms", { propertyId: propA.id, roomNumber: "A-2", monthlyRent: 4200, capacity: 1 }, ownerAToken);
  roomA2 = r.json?.data;

  r = await req("POST", "/api/owner/properties", { name: "Beta Dorm", address: "2 Beta St", contactNumber: "09110000002" }, ownerBToken);
  propB = r.json?.data;
  r = await req("POST", "/api/owner/rooms", { propertyId: propB.id, roomNumber: "B-1", monthlyRent: 5000, capacity: 1 }, ownerBToken);
  roomB1 = r.json?.data;
  assert("Rooms created", !!(roomA1 && roomA2 && roomB1));
}

async function testEligibilityAndSecurity() {
  console.log("\n=== Eligibility and security ===");
  let r = await req("POST", "/api/ratings", { rateeId: ownerAId, stars: 5 }, tenant1Token);
  assert("Tenant cannot rate owner without a lease", r.status === 403, `status=${r.status}`);

  r = await req("POST", "/api/ratings", { rateeId: tenant1Id, stars: 5 }, ownerAToken);
  assert("Owner cannot rate tenant without a lease", r.status === 403, `status=${r.status}`);

  r = await req("POST", "/api/ratings", { rateeId: ownerAId, stars: 5 });
  assert("Unauthenticated rating is 401", r.status === 401, `status=${r.status}`);

  r = await req("POST", "/api/ratings", { rateeId: ownerAId, stars: 5 }, adminToken);
  assert("Admin cannot submit ratings", r.status === 403, `status=${r.status}`);

  r = await req("POST", "/api/ratings", { rateeId: ownerAId, stars: 5 }, ownerAToken);
  assert("Owner cannot rate themself", r.status === 400, `status=${r.status}`);

  r = await req("POST", "/api/ratings", { rateeId: ownerAId, stars: 9 }, tenant1Token);
  assert("Invalid stars rejected", r.status === 400, `status=${r.status}`);
}

async function testSubmitAndNotify() {
  console.log("\n=== Submit ratings ===");
  let r = await req("POST", "/api/owner/leases", { tenantId: tenant1Id, roomId: roomA1.id, startDate: "2026-10-01" }, ownerAToken);
  assert("Lease T1 ↔ Owner A", r.status === 201 || r.status === 200, `status=${r.status} ${r.json?.message}`);

  r = await req("POST", "/api/owner/leases", { tenantId: tenant3Id, roomId: roomA2.id, startDate: "2026-10-01" }, ownerAToken);
  assert("Lease T3 ↔ Owner A", r.status === 201 || r.status === 200, `status=${r.status} ${r.json?.message}`);

  r = await req("POST", "/api/owner/leases", { tenantId: tenant2Id, roomId: roomB1.id, startDate: "2026-10-01" }, ownerBToken);
  assert("Lease T2 ↔ Owner B", r.status === 201 || r.status === 200, `status=${r.status} ${r.json?.message}`);

  r = await req("POST", "/api/ratings", { rateeId: ownerBId, stars: 5 }, tenant1Token);
  assert("T1 cannot rate Owner B (no lease)", r.status === 403, `status=${r.status}`);

  r = await req("POST", "/api/ratings", { rateeId: tenant1Id, stars: 4 }, ownerBToken);
  assert("Owner B cannot rate T1", r.status === 403, `status=${r.status}`);

  r = await req("POST", "/api/ratings", { rateeId: ownerAId, stars: 5, comment: "Great dorm" }, tenant1Token);
  assert("T1 rates Owner A five stars", r.status === 201, `status=${r.status}`);

  r = await req("POST", "/api/ratings", { rateeId: ownerAId, stars: 5, comment: "Also excellent" }, tenant3Token);
  assert("T3 rates Owner A five stars", r.status === 201, `status=${r.status}`);

  r = await req("POST", "/api/ratings", { rateeId: ownerBId, stars: 5, comment: "Nice place" }, tenant2Token);
  assert("T2 rates Owner B five stars", r.status === 201, `status=${r.status}`);

  r = await req("POST", "/api/ratings", { rateeId: tenant1Id, stars: 4, comment: "Good tenant" }, ownerAToken);
  assert("Owner A rates T1", r.status === 201, `status=${r.status}`);

  const notifs = await req("GET", "/api/notifications", null, ownerAToken);
  const ratingNotifs = (notifs.json?.data ?? []).filter((n) => n.type === "rating_received");
  assert("Owner A is notified of new ratings", ratingNotifs.length >= 1, `count=${ratingNotifs.length}`);

  r = await req("POST", "/api/ratings", { rateeId: ownerAId, stars: 5, comment: "Updated comment" }, tenant1Token);
  assert("T1 can update their rating", r.status === 200, `status=${r.status}`);

  const profile = await req("GET", `/api/ratings/users/${ownerAId}`, null, tenant1Token);
  assert("Owner A summary is readable", profile.status === 200, `status=${profile.status}`);
  assert("Owner A has two five-star ratings", profile.json?.data?.summary?.fiveStarCount === 2, JSON.stringify(profile.json?.data?.summary));
  assert("T1 canRate Owner A", profile.json?.data?.canRate === true);
  assert("T1 myRating is five stars", profile.json?.data?.myRating?.stars === 5);
}

async function testBrowseRanking() {
  console.log("\n=== Browse ranking ===");
  const r = await req("GET", "/api/tenant/browse/dorms", null, tenant1Token);
  assert("Browse returns 200", r.status === 200, `status=${r.status}`);
  const list = r.json?.data ?? [];
  const alpha = list.find((d) => d.name === "Alpha Dorm");
  const beta = list.find((d) => d.name === "Beta Dorm");
  assert("Both test dorms appear", !!(alpha && beta), `count=${list.length}`);
  assert("Alpha has two five-star ratings", alpha?.ownerFiveStarCount === 2, JSON.stringify(alpha));
  assert("Beta has one five-star rating", beta?.ownerFiveStarCount === 1, JSON.stringify(beta));

  const alphaIndex = list.findIndex((d) => d.name === "Alpha Dorm");
  const betaIndex = list.findIndex((d) => d.name === "Beta Dorm");
  assert("Owner with most five-star ratings appears first", alphaIndex >= 0 && alphaIndex < betaIndex, `alpha=${alphaIndex} beta=${betaIndex}`);

  const maxFive = list.reduce((max, d) => Math.max(max, Number(d.ownerFiveStarCount || 0)), 0);
  if (alpha.ownerFiveStarCount === maxFive) {
    assert("Alpha is marked top rated", alpha.isTopRated === true);
  }

  const searched = await req("GET", "/api/tenant/browse/dorms?search=Alpha", null, tenant1Token);
  const searchedList = searched.json?.data ?? [];
  assert("Search still returns the top-rated matching dorm", searchedList[0]?.name === "Alpha Dorm", JSON.stringify(searchedList.map((d) => d.name)));
}

async function cleanup() {
  const emails = [OWNER_A, OWNER_B, TENANT_1, TENANT_2, TENANT_3];
  await POOL.query(`DELETE FROM ratings WHERE rater_id IN (SELECT id FROM users WHERE email = ANY($1::text[])) OR ratee_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [emails]);
  await POOL.query(`DELETE FROM leases WHERE tenant_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [emails]);
  await POOL.query(`DELETE FROM rooms WHERE property_id IN (SELECT id FROM properties WHERE owner_id IN (SELECT id FROM users WHERE email = ANY($1::text[])))`, [emails]);
  await POOL.query(`DELETE FROM properties WHERE owner_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [emails]);
  await POOL.query(`DELETE FROM notifications WHERE recipient_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [emails]);
  await POOL.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [emails]);
}

(async () => {
  try {
    await setup();
    await testEligibilityAndSecurity();
    await testSubmitAndNotify();
    await testBrowseRanking();
    console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
    process.exitCode = failed > 0 ? 1 : 0;
  } catch (error) {
    console.error("\nTEST RUN ERROR:", error);
    process.exitCode = 1;
  } finally {
    await cleanup().catch((e) => console.error("CLEANUP ERROR:", e.message));
    await POOL.end().catch(() => {});
  }
})();
