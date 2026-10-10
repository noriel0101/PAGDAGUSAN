/**
 * Roommate matching: tenant 1 reserves with preferences, tenant 2 sees a match
 * while browsing that boarding house.
 * Requires the API on :5000.
 */
const API = "http://localhost:5000";
const pool = require("./db");
const bcrypt = require("bcryptjs");

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
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

function tokenOf(res) {
  return res?.json?.token ?? res?.json?.data?.token ?? null;
}

const PW = "Test1234!";
const stamp = Date.now();
const OWNER = `match_owner_${stamp}@test.com`;
const TENANT1 = `match_tenant1_${stamp}@test.com`;
const TENANT2 = `match_tenant2_${stamp}@test.com`;

(async () => {
  const hash = await bcrypt.hash(PW, 10);
  const ownerIns = await pool.query(
    `INSERT INTO users (name, email, phone, password_hash, role, status, email_verified)
     VALUES ($1,$2,$3,$4,'owner','active',true) RETURNING id`,
    ["Match Owner", OWNER, "09110000001", hash]
  );
  const t1 = await pool.query(
    `INSERT INTO users (name, email, phone, password_hash, role, status, email_verified)
     VALUES ($1,$2,$3,$4,'tenant','active',true) RETURNING id`,
    ["Ana Reyes", TENANT1, "09110000002", hash]
  );
  const t2 = await pool.query(
    `INSERT INTO users (name, email, phone, password_hash, role, status, email_verified)
     VALUES ($1,$2,$3,$4,'tenant','active',true) RETURNING id`,
    ["Ben Cruz", TENANT2, "09110000003", hash]
  );
  const ownerId = ownerIns.rows[0].id;
  const tenant1Id = t1.rows[0].id;
  const tenant2Id = t2.rows[0].id;

  try {
    const ownerLogin = await req("POST", "/api/auth/login", { email: OWNER, password: PW });
    const ownerToken = tokenOf(ownerLogin);
    assert("Owner logs in", !!ownerToken, JSON.stringify(ownerLogin.json));

    const property = await req("POST", "/api/owner/properties", {
      name: "Match House", address: "1 Match St", contactNumber: "09170000001",
    }, ownerToken);
    assert("Property created", property.status === 201, `status=${property.status}`);
    const propertyId = property.json?.data?.id;

    const room = await req("POST", "/api/owner/rooms", {
      propertyId, roomNumber: "M-1", monthlyRent: 4000, capacity: 2,
    }, ownerToken);
    assert("Shared room created", room.status === 201, `status=${room.status}`);
    const roomId = room.json?.data?.id;

    const tenant1Login = await req("POST", "/api/auth/login", { email: TENANT1, password: PW });
    const tenant1Token = tokenOf(tenant1Login);
    const reserved = await req("POST", "/api/tenant/reservations", {
      roomId,
      roommatePreferences: { nonSmoker: true, nonDrinker: true },
    }, tenant1Token);
    assert("Reservation stores roommate preferences", reserved.status === 201 && reserved.json?.data?.roommatePreferences?.nonSmoker === true && reserved.json?.data?.roommatePreferences?.nonDrinker === true, `status=${reserved.status} ${JSON.stringify(reserved.json)}`);

    const tenant2Login = await req("POST", "/api/auth/login", { email: TENANT2, password: PW });
    const tenant2Token = tokenOf(tenant2Login);

    const before = await req("GET", "/api/tenant/browse/dorms", null, tenant2Token);
    const dormBefore = (before.json?.data || []).find((d) => d.id === propertyId);
    assert("Browse shows the request before habits are set", dormBefore?.roommateRequestCount === 1 && dormBefore?.roommateMatchCount === 0, JSON.stringify(dormBefore && { roommateRequestCount: dormBefore.roommateRequestCount, roommateMatchCount: dormBefore.roommateMatchCount }));

    const saved = await req("PUT", "/api/tenant/lifestyle", { nonSmoker: true, nonDrinker: true }, tenant2Token);
    assert("Tenant 2 saves non-smoker and non-drinker", saved.status === 200 && saved.json?.data?.nonSmoker === true, `status=${saved.status}`);

    const after = await req("GET", `/api/tenant/browse/dorms/${propertyId}`, null, tenant2Token);
    const listed = (after.json?.data?.rooms || []).flatMap((r) => r.roommates || []);
    assert("Browsing tenant sees a match", listed.length === 1 && listed[0].match === true && listed[0].firstName === "Ana", JSON.stringify(listed));
    assert("Contact details stay hidden", listed[0] && !("email" in listed[0]) && !("phone" in listed[0]));

    await req("PUT", "/api/tenant/lifestyle", { nonSmoker: false, nonDrinker: true }, tenant2Token);
    const missed = await req("GET", `/api/tenant/browse/rooms/${roomId}`, null, tenant2Token);
    assert("A smoker is not a match", missed.json?.data?.roommates?.[0]?.match === false, JSON.stringify(missed.json?.data?.roommates));

    const aligned = {
      nonSmoker: true,
      nonDrinker: true,
      budgetMax: 5000,
      roomShare: "shared",
      sleepSchedule: "early",
      cleanliness: 5,
      noiseTolerance: "quiet",
      studyHabit: "alone",
      socialPreference: "private",
      petPreference: "no_pets",
      interests: ["reading", "chess"],
    };
    const savedProfiles = await Promise.all([
      req("PUT", "/api/tenant/lifestyle", aligned, tenant1Token),
      req("PUT", "/api/tenant/lifestyle", aligned, tenant2Token),
    ]);
    assert("Both compatibility profiles save", savedProfiles.every((item) => item.status === 200), savedProfiles.map((item) => item.json?.message).join(" | "));

    const strong = await req("GET", `/api/tenant/browse/rooms/${roomId}`, null, tenant2Token);
    const strongRow = strong.json?.data?.roommates?.[0];
    assert(
      "Aligned profiles score as a strong match",
      strongRow?.match === true && strongRow?.compatibility?.score >= 80,
      JSON.stringify(strongRow?.compatibility)
    );
    assert(
      "Score does not include budget or contact details",
      strongRow && !("email" in strongRow) && !("phone" in strongRow) && !JSON.stringify(strongRow.compatibility).includes("5000")
    );

    await req("PUT", "/api/tenant/lifestyle", {
      ...aligned,
      budgetMax: 20000,
      sleepSchedule: "late",
      cleanliness: 1,
      noiseTolerance: "lively",
      studyHabit: "group",
      socialPreference: "social",
      petPreference: "has_pets",
      interests: ["parties"],
    }, tenant2Token);
    const low = await req("GET", `/api/tenant/browse/rooms/${roomId}`, null, tenant2Token);
    const lowRow = low.json?.data?.roommates?.[0];
    assert(
      "Different habits score as a low match",
      lowRow?.match === false && lowRow?.compatibility?.score < 60,
      JSON.stringify(lowRow?.compatibility)
    );

    const own = await req("GET", "/api/tenant/reservations", null, tenant1Token);
    const mine = (own.json?.data || []).find((item) => item.roomId === roomId);
    assert("Applicant can see their own preferences", mine?.roommatePreferences?.nonDrinker === true);
  } finally {
    await pool.query(`DELETE FROM leases WHERE tenant_id = ANY($1::uuid[])`, [[tenant1Id, tenant2Id]]);
    await pool.query(`DELETE FROM tenant_lifestyles WHERE tenant_id = ANY($1::uuid[])`, [[tenant1Id, tenant2Id]]);
    await pool.query(`DELETE FROM rooms WHERE property_id IN (SELECT id FROM properties WHERE owner_id = $1)`, [ownerId]);
    await pool.query(`DELETE FROM properties WHERE owner_id = $1`, [ownerId]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ownerId, tenant1Id, tenant2Id]]);
    await pool.end();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
