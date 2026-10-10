/**
 * Cross-owner non-disclosure policy test.
 *
 * Policy under test: for an authenticated owner, a property/room resource that
 * belongs to somebody else must be externally indistinguishable from one that
 * does not exist — both answer 404 with the same body, and neither reveals the
 * other owner's data or identity.
 *
 * Covered endpoints:
 *   PUT    /api/owner/properties/:id
 *   PATCH  /api/owner/properties/:id/location
 *   POST   /api/owner/properties/:propertyId/rooms
 *   POST   /api/owner/rooms
 *   POST   /api/owner/leases
 *   POST   /api/owner/tenants
 *   GET    /api/owner/properties/:id/photos
 *   POST   /api/owner/properties/:id/photos
 *   DELETE /api/owner/properties/:propertyId/photos/:photoId
 *   PATCH  /api/owner/properties/:propertyId/photos/:photoId/primary
 *
 * Also pins the two 403s that must stay 403 (role isolation, announcement
 * action authorization) so the policy cannot silently widen.
 */
const API = "http://localhost:5000";
const STAMP = Date.now();
const GHOST = "00000000-0000-0000-0000-000000000000";

let passed = 0;
let failed = 0;
const failures = [];

function assert(label, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
    failures.push(label);
  }
}

function section(name) {
  console.log(`\n=== ${name} ===`);
}

async function req(method, path, body, token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const opts = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${API}${path}`, opts);
  const json = await res.json().catch(() => null);
  return { status: res.status, json, raw: JSON.stringify(json) };
}

// ─── The 5 checks every endpoint must satisfy ───────────────────────────
function assertPolicy(label, { own, ghost, cross, ghostBody, ownBody, crossBody, crossRaw, secrets }) {
  assert(`${label} — owner can act on own resource`, own.status < 300, `status=${own.status} ${ownBody}`);
  assert(`${label} — nonexistent resource → 404`, ghost.status === 404, `status=${ghost.status}`);
  assert(`${label} — cross-owner resource → 404`, cross.status === 404, `status=${cross.status}`);
  assert(
    `${label} — cross-owner body identical to nonexistent body`,
    cross.json?.message === ghost.json?.message && cross.json?.success === ghost.json?.success,
    `cross=${crossBody} ghost=${ghostBody}`
  );
  if (crossRaw && secrets && secrets.length) {
    const leaked = secrets.filter((s) => s && crossRaw.includes(s));
    assert(`${label} — response leaks nothing about the other owner`, leaked.length === 0, `leaked=${leaked.join(",")}`);
  }
}

(async () => {
  const pool = require("./db");
  const bcrypt = require("bcryptjs");
  const PW = "Test1234!";
  const emailA = `nda_a_${STAMP}@test.com`;
  const emailB = `nda_b_${STAMP}@test.com`;
  const emailT = `nda_t_${STAMP}@test.com`;

  let tokenA, tokenB, tokenT;
  let idA, idB, idT;
  let propA, propB, roomA, roomB, photoA, photoB;
  const createdEmails = [emailA, emailB, emailT];
  const createdProps = [];
  const createdRooms = [];

  try {
    // ── Setup ───────────────────────────────────────────────────────────
    section("SETUP");
    const hash = await bcrypt.hash(PW, 12);
    for (const [email, name, role] of [
      [emailA, "NDA Owner A", "owner"],
      [emailB, "NDA Owner B", "owner"],
      [emailT, "NDA Tenant", "tenant"],
    ]) {
      await pool.query(
        `INSERT INTO users (name, email, phone, password_hash, role, status, email_verified)
         VALUES ($1,$2,$3,$4,$5,'active',true)`,
        [name, email, `097${STAMP}`.slice(-10), hash, role]
      );
    }
    ({ id: idA } = (await pool.query(`SELECT id FROM users WHERE email=$1`, [emailA])).rows[0]);
    ({ id: idB } = (await pool.query(`SELECT id FROM users WHERE email=$1`, [emailB])).rows[0]);
    ({ id: idT } = (await pool.query(`SELECT id FROM users WHERE email=$1`, [emailT])).rows[0]);

    for (const [email, id] of [[emailA, idA], [emailB, idB]]) {
      const r = await req("POST", "/api/auth/login", { email, password: PW });
      if (email === emailA) tokenA = r.json?.token ?? r.json?.data?.token;
      else tokenB = r.json?.token ?? r.json?.data?.token;
      assert(`${email} logs in`, !!(email === emailA ? tokenA : tokenB), `status=${r.status}`);
    }
    tokenT = (await req("POST", "/api/auth/login", { email: emailT, password: PW })).json?.token;

    for (const [token, name] of [[tokenA, "NDA Dorm A"], [tokenB, "NDA Dorm B"]]) {
      const r = await req("POST", "/api/owner/properties", { name, address: "55 Policy St" }, token);
      createdProps.push(r.json?.data?.id);
    }
    propA = createdProps[0];
    propB = createdProps[1];
    assert("Two properties created", !!propA && !!propB);

    for (const [token, propId] of [[tokenA, propA], [tokenB, propB]]) {
      const r = await req("POST", "/api/owner/rooms", {
        propertyId: propId, roomNumber: "P-101", monthlyRent: 5000, capacity: 1,
      }, token);
      if (propId === propA) roomA = r.json?.data?.id;
      else roomB = r.json?.data?.id;
      createdRooms.push(r.json?.data?.id);
    }
    assert("Two rooms created", !!roomA && !!roomB);

    for (const [propId, key] of [[propA, "photoA"], [propB, "photoB"]]) {
      const r = await pool.query(
        `INSERT INTO property_photos (property_id, photo_url, is_primary)
         VALUES ($1, $2, true) RETURNING id`,
        [propId, `http://localhost:5000/uploads/property-photos/nda-${STAMP}.jpg`]
      );
      if (propId === propA) photoA = r.rows[0].id;
      else photoB = r.rows[0].id;
    }
    assert("Two photos seeded", !!photoA && !!photoB);

    const secrets = ["NDA Owner B", idB, "NDA Dorm B"];
    const propBBefore = (await pool.query(`SELECT * FROM properties WHERE id=$1`, [propB])).rows[0];
    const roomBBefore = (await pool.query(`SELECT * FROM rooms WHERE id=$1`, [roomB])).rows[0];
    const photosBBefore = (await pool.query(`SELECT id FROM property_photos WHERE property_id=$1`, [propB])).rows.map((r) => r.id);

    // ── 1. PUT /properties/:id ──────────────────────────────────────────
    section("PUT /api/owner/properties/:id");
    {
      const own = await req("PUT", `/api/owner/properties/${propA}`, { name: "NDA Dorm A v2", address: "56 Policy St" }, tokenA);
      const ghost = await req("PUT", `/api/owner/properties/${GHOST}`, { name: "x", address: "y" }, tokenA);
      const cross = await req("PUT", `/api/owner/properties/${propB}`, { name: "HACKED", address: "HACKED" }, tokenA);
      assertPolicy("PUT property", { own, ghost, cross, crossRaw: cross.raw, secrets });
      const after = (await pool.query(`SELECT name, address FROM properties WHERE id=$1`, [propB])).rows[0];
      assert("PUT property — B's data unchanged", after.name === propBBefore.name && after.address === propBBefore.address,
        JSON.stringify(after));
    }

    // ── 2. PATCH /properties/:id/location ───────────────────────────────
    section("PATCH /api/owner/properties/:id/location");
    {
      const own = await req("PATCH", `/api/owner/properties/${propA}/location`, { latitude: 14.5995, longitude: 120.9842 }, tokenA);
      const ghost = await req("PATCH", `/api/owner/properties/${GHOST}/location`, { latitude: 1, longitude: 1 }, tokenA);
      const cross = await req("PATCH", `/api/owner/properties/${propB}/location`, { latitude: 0, longitude: 0 }, tokenA);
      assertPolicy("PATCH location", { own, ghost, cross, crossRaw: cross.raw, secrets });
      const after = (await pool.query(`SELECT latitude, longitude FROM properties WHERE id=$1`, [propB])).rows[0];
      assert("PATCH location — B's coordinates unchanged",
        after.latitude === propBBefore.latitude && after.longitude === propBBefore.longitude,
        JSON.stringify(after));
      // The owner-scoped UPDATE must match 0 rows, not merely be skipped by a guard.
      const probe = await pool.query(
        `UPDATE properties SET latitude = 9, longitude = 9 WHERE id = $1 AND owner_id = $2 RETURNING id`,
        [propB, idA]
      );
      assert("PATCH location — owner-scoped UPDATE matches 0 rows cross-owner", probe.rows.length === 0, `rows=${probe.rows.length}`);
    }

    // ── 3. POST /properties/:propertyId/rooms ───────────────────────────
    section("POST /api/owner/properties/:propertyId/rooms");
    {
      const own = await req("POST", `/api/owner/properties/${propA}/rooms`, { roomNumber: "P-201", monthlyRent: 4500 }, tokenA);
      const ghost = await req("POST", `/api/owner/properties/${GHOST}/rooms`, { roomNumber: "X", monthlyRent: 1 }, tokenA);
      const cross = await req("POST", `/api/owner/properties/${propB}/rooms`, { roomNumber: "HACK", monthlyRent: 1 }, tokenA);
      assertPolicy("POST rooms (nested)", { own, ghost, cross, crossRaw: cross.raw, secrets });
      const count = (await pool.query(`SELECT COUNT(*)::int c FROM rooms WHERE property_id=$1`, [propB])).rows[0].c;
      assert("POST rooms (nested) — B gained no room", count === 1, `rooms=${count}`);
    }

    // ── 4. POST /rooms ──────────────────────────────────────────────────
    section("POST /api/owner/rooms");
    {
      const own = await req("POST", "/api/owner/rooms", { propertyId: propA, roomNumber: "P-202", monthlyRent: 4400 }, tokenA);
      const ghost = await req("POST", "/api/owner/rooms", { propertyId: GHOST, roomNumber: "X", monthlyRent: 1 }, tokenA);
      const cross = await req("POST", "/api/owner/rooms", { propertyId: propB, roomNumber: "HACK", monthlyRent: 1 }, tokenA);
      assertPolicy("POST rooms (body)", { own, ghost, cross, crossRaw: cross.raw, secrets });
      const count = (await pool.query(`SELECT COUNT(*)::int c FROM rooms WHERE property_id=$1`, [propB])).rows[0].c;
      assert("POST rooms (body) — B gained no room", count === 1, `rooms=${count}`);
    }

    // ── 5. POST /leases ─────────────────────────────────────────────────
    section("POST /api/owner/leases");
    {
      const own = await req("POST", "/api/owner/leases", { tenantId: idT, roomId: roomA, startDate: "2026-10-01" }, tokenA);
      const ghost = await req("POST", "/api/owner/leases", { tenantId: idT, roomId: GHOST }, tokenA);
      const cross = await req("POST", "/api/owner/leases", { tenantId: idT, roomId: roomB }, tokenA);
      assertPolicy("POST leases", { own, ghost, cross, crossRaw: cross.raw, secrets });
      const after = (await pool.query(`SELECT COUNT(*)::int c FROM leases WHERE room_id=$1`, [roomB])).rows[0].c;
      assert("POST leases — B gained no lease", after === 0, `leases=${after}`);
    }

    // ── 6. POST /tenants (with roomId) ──────────────────────────────────
    section("POST /api/owner/tenants (with roomId)");
    {
      // A dedicated room: the leases test above already filled roomA (capacity 1),
      // which would 409 on capacity rather than exercise the ownership check.
      const spare = await req("POST", "/api/owner/rooms", { propertyId: propA, roomNumber: "P-301", monthlyRent: 4300, capacity: 1 }, tokenA);
      const roomSpare = spare.json?.data?.id;
      const newEmail = `nda_new_${STAMP}@test.com`;
      createdEmails.push(newEmail);
      const own = await req("POST", "/api/owner/tenants", { name: "NDA New", email: newEmail, password: PW, roomId: roomSpare }, tokenA);
      const ghost = await req("POST", "/api/owner/tenants", { name: "NDA G", email: `nda_g_${STAMP}@test.com`, password: PW, roomId: GHOST }, tokenA);
      createdEmails.push(`nda_g_${STAMP}@test.com`);
      const cross = await req("POST", "/api/owner/tenants", { name: "NDA X", email: `nda_x_${STAMP}@test.com`, password: PW, roomId: roomB }, tokenA);
      createdEmails.push(`nda_x_${STAMP}@test.com`);
      assertPolicy("POST tenants", { own, ghost, cross, crossRaw: cross.raw, secrets });
      const after = (await pool.query(`SELECT COUNT(*)::int c FROM leases WHERE room_id=$1`, [roomB])).rows[0].c;
      assert("POST tenants — B gained no lease", after === 0, `leases=${after}`);
    }

    // ── 7. GET /properties/:id/photos ───────────────────────────────────
    section("GET /api/owner/properties/:id/photos");
    {
      const own = await req("GET", `/api/owner/properties/${propA}/photos`, undefined, tokenA);
      const ghost = await req("GET", `/api/owner/properties/${GHOST}/photos`, undefined, tokenA);
      const cross = await req("GET", `/api/owner/properties/${propB}/photos`, undefined, tokenA);
      assertPolicy("GET photos", { own, ghost, cross, crossRaw: cross.raw, secrets });
      assert("GET photos — B's photo url not returned", !(cross.raw || "").includes(`nda-${STAMP}.jpg`), cross.raw);
    }

    // ── 8. POST /properties/:id/photos (multipart) ──────────────────────
    section("POST /api/owner/properties/:id/photos (multipart)");
    {
      async function upload(propertyId, token) {
        const form = new FormData();
        form.append("photo", new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }), "nda.jpg");
        const res = await fetch(`${API}/api/owner/properties/${propertyId}/photos`, {
          method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form,
        });
        return { status: res.status, json: await res.json().catch(() => null), raw: JSON.stringify(await Promise.resolve(null)) };
      }
      const own = await upload(propA, tokenA);
      const cross = await upload(propB, tokenA);
      const ghost = await upload(GHOST, tokenA);
      assert("POST photos — owner can upload to own property", own.status < 300, `status=${own.status}`);
      assert("POST photos — cross-owner property → 404", cross.status === 404, `status=${cross.status}`);
      assert("POST photos — nonexistent property → 404", ghost.status === 404, `status=${ghost.status}`);
      const count = (await pool.query(`SELECT COUNT(*)::int c FROM property_photos WHERE property_id=$1`, [propB])).rows[0].c;
      assert("POST photos — B gained no photo", count === photosBBefore.length, `photos=${count}`);
    }

    // ── 9. DELETE /properties/:pid/photos/:phid ─────────────────────────
    section("DELETE /api/owner/properties/:propertyId/photos/:photoId");
    {
      const cross = await req("DELETE", `/api/owner/properties/${propB}/photos/${photoB}`, undefined, tokenA);
      const ghost = await req("DELETE", `/api/owner/properties/${propA}/photos/${GHOST}`, undefined, tokenA);
      const own = await req("DELETE", `/api/owner/properties/${propA}/photos/${photoA}`, undefined, tokenA);
      assert("DELETE photos — cross-owner photo → 404", cross.status === 404, `status=${cross.status}`);
      assert("DELETE photos — nonexistent photo → 404", ghost.status === 404, `status=${ghost.status}`);
      assert("DELETE photos — owner can delete own photo", own.status === 200, `status=${own.status}`);
      const still = (await pool.query(`SELECT COUNT(*)::int c FROM property_photos WHERE id=$1`, [photoB])).rows[0].c;
      assert("DELETE photos — B's photo still exists", still === 1, `count=${still}`);
    }

    // ── 10. PATCH photos/:phid/primary ──────────────────────────────────
    section("PATCH /api/owner/properties/:propertyId/photos/:photoId/primary");
    {
      // Fresh photo: the delete case above intentionally removed photoA.
      const fresh = await pool.query(
        `INSERT INTO property_photos (property_id, photo_url, is_primary)
         VALUES ($1, $2, false) RETURNING id`,
        [propA, `http://localhost:5000/uploads/property-photos/nda-primary-${STAMP}.jpg`]
      );
      const photoA2 = fresh.rows[0].id;
      const cross = await req("PATCH", `/api/owner/properties/${propB}/photos/${photoB}/primary`, {}, tokenA);
      const ghost = await req("PATCH", `/api/owner/properties/${propA}/photos/${GHOST}/primary`, {}, tokenA);
      const own = await req("PATCH", `/api/owner/properties/${propA}/photos/${photoA2}/primary`, {}, tokenA);
      assert("PATCH primary — cross-owner photo → 404", cross.status === 404, `status=${cross.status}`);
      assert("PATCH primary — nonexistent photo → 404", ghost.status === 404, `status=${ghost.status}`);
      assert("PATCH primary — owner can set own photo primary", own.status === 200, `status=${own.status}`);
      const still = (await pool.query(`SELECT is_primary FROM property_photos WHERE id=$1`, [photoB])).rows[0];
      assert("PATCH primary — B's photo flag untouched", still.is_primary === true, `is_primary=${still.is_primary}`);
    }

    // ── 403s that must stay 403 ────────────────────────────────────────
    section("403s that must remain 403");
    {
      const admin = await req("GET", "/api/admin/owners", undefined, tokenA);
      assert("Role isolation: owner → /api/admin/owners still 403", admin.status === 403, `status=${admin.status}`);
      const stats = await req("GET", "/api/admin/stats", undefined, tokenA);
      assert("Role isolation: owner → /api/admin/stats still 403", stats.status === 403, `status=${stats.status}`);

      const ann = await req("POST", "/api/owner/announcements", {
        title: "Cross", content: "Should not be created", propertyId: propB,
      }, tokenA);
      assert("Announcement action auth: foreign propertyId still 403", ann.status === 403, `status=${ann.status}`);

      const annCheck = (await pool.query(`SELECT COUNT(*)::int c FROM announcements WHERE owner_id=$1`, [idA])).rows[0].c;
      assert("Announcement action auth — no announcement was created", annCheck === 0, `count=${annCheck}`);
    }

    // ── Authentication unchanged ───────────────────────────────────────
    section("AUTHENTICATION UNCHANGED");
    {
      for (const [m, p, b] of [
        ["PUT", `/api/owner/properties/${propB}`, { name: "x", address: "y" }],
        ["PATCH", `/api/owner/properties/${propB}/location`, { latitude: 1, longitude: 1 }],
        ["POST", "/api/owner/rooms", { propertyId: propB, roomNumber: "H", monthlyRent: 1 }],
        ["POST", "/api/owner/leases", { tenantId: idT, roomId: roomB }],
        ["GET", `/api/owner/properties/${propB}/photos`, undefined],
      ]) {
        const r = await req(m, p, b, null);
        assert(`Unauthenticated ${m} ${p.split("/").pop()} → 401`, r.status === 401, `status=${r.status}`);
      }
    }

    // ── Final data-integrity sweep ─────────────────────────────────────
    section("DATA INTEGRITY");
    {
      const after = (await pool.query(`SELECT * FROM properties WHERE id=$1`, [propB])).rows[0];
      assert("B's property row completely unchanged",
        after.name === propBBefore.name && after.address === propBBefore.address &&
        after.latitude === propBBefore.latitude && after.longitude === propBBefore.longitude &&
        after.owner_id === propBBefore.owner_id && after.description === propBBefore.description,
        JSON.stringify({ before: { n: propBBefore.name, l: propBBefore.latitude }, after: { n: after.name, l: after.latitude } }));
      const roomAfter = (await pool.query(`SELECT * FROM rooms WHERE id=$1`, [roomB])).rows[0];
      assert("B's room row unchanged",
        roomAfter.room_number === roomBBefore.room_number && roomAfter.monthly_rent === roomBBefore.monthly_rent &&
        roomAfter.status === roomBBefore.status, JSON.stringify(roomAfter));
      const photosAfter = (await pool.query(`SELECT id FROM property_photos WHERE property_id=$1`, [propB])).rows.map((r) => r.id);
      assert("B's photo set unchanged",
        JSON.stringify(photosAfter) === JSON.stringify(photosBBefore),
        `${JSON.stringify(photosAfter)} vs ${JSON.stringify(photosBBefore)}`);
    }
  } catch (e) {
    console.error("\nTEST ERROR:", e);
    failures.push("UNCAUGHT: " + e.message);
    failed++;
  } finally {
    // ── Cleanup (children first) ───────────────────────────────────────
    try {
      await pool.query(`DELETE FROM announcements WHERE owner_id IN ($1,$2)`, [idA, idB]);
      for (const p of createdProps) if (p) await pool.query(`DELETE FROM property_photos WHERE property_id=$1`, [p]);
      for (const p of createdProps) if (p) await pool.query(`DELETE FROM rooms WHERE property_id=$1`, [p]);
      for (const p of createdProps) if (p) await pool.query(`DELETE FROM leases WHERE room_id IN (SELECT id FROM rooms WHERE property_id=$1)`, [p]);
      for (const p of createdProps) if (p) await pool.query(`DELETE FROM properties WHERE id=$1`, [p]);
      await pool.query(`DELETE FROM users WHERE email = ANY($1)`, [createdEmails]);
      console.log("\n=== CLEANUP: done ===");
    } catch (e) {
      console.error("Cleanup error:", e.message);
    }
    await pool.end().catch(() => {});
  }

  if (failures.length) console.log(`\nFailed:\n  - ${failures.join("\n  - ")}`);
  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exitCode = failed > 0 ? 1 : 0;
})();
