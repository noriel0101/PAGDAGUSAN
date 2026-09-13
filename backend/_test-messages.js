/**
 * Messages module integration/security test.
 * Covers: authentication (401), validation (400), role isolation (admin 403),
 * relationship authorization (403 for unrelated users), send/receive,
 * thread read-marking, PATCH read (receiver-only, idempotent),
 * unread count, conversation list, and conversation filtering.
 *
 * Requires: server running on :5000 with latest route code.
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

function userId(res) {
  return res?.json?.data?.id ?? null;
}

const TS = Date.now();
const OWNER_A_EMAIL = `msg_ownera_${TS}@test.com`;
const OWNER_B_EMAIL = `msg_ownerb_${TS}@test.com`;
const TENANT_A_EMAIL = `msg_tenanta_${TS}@test.com`;
const TENANT_B_EMAIL = `msg_tenantb_${TS}@test.com`;
const PW = "Test1234!";

let ownerAToken, ownerBToken, tenantAToken, tenantBToken, adminToken;
let ownerAId, ownerBId;
let tenantAId, tenantBId;
let roomA1, roomA2;

let msgAtoB, msgBtoA, msgOwnerAToTenantB;

async function activateOwners(...ids) {
  const pool = require("./db");
  await pool.query(`UPDATE users SET status = 'active' WHERE id = ANY($1::uuid[])`, [ids]);
}

// ─── Setup ────────────────────────────────────────────────
async function setup() {
  console.log("\n=== SETUP ===");
  const pool = require("./db");

  // Register Owner A, Owner B
  let r = await req("POST", "/api/auth/register-owner", {
    name: "Msg Owner A", email: OWNER_A_EMAIL, phone: "09123450001", password: PW,
  });
  assert("Owner A registered", r.status === 201, `status=${r.status}`);
  ownerAId = userId(r);

  r = await req("POST", "/api/auth/register-owner", {
    name: "Msg Owner B", email: OWNER_B_EMAIL, phone: "09123450002", password: PW,
  });
  assert("Owner B registered", r.status === 201, `status=${r.status}`);
  ownerBId = userId(r);

  await activateOwners(ownerAId, ownerBId);

  r = await req("POST", "/api/auth/login", { email: OWNER_A_EMAIL, password: PW });
  assert("Owner A logs in", r.status === 200, `status=${r.status}`);
  ownerAToken = loginToken(r);

  r = await req("POST", "/api/auth/login", { email: OWNER_B_EMAIL, password: PW });
  assert("Owner B logs in", r.status === 200, `status=${r.status}`);
  ownerBToken = loginToken(r);

  // Create two rooms for Owner A
  const propA = (await req("POST", "/api/owner/properties", {
    name: "Msg Test Dorm A", address: "1 Msg St A",
  }, ownerAToken)).json?.data;

  if (propA) {
    roomA1 = (await req("POST", "/api/owner/rooms", {
      propertyId: propA.id, roomNumber: "MSG-A1", monthlyRent: 5000, capacity: 3,
    }, ownerAToken)).json?.data;
    roomA2 = (await req("POST", "/api/owner/rooms", {
      propertyId: propA.id, roomNumber: "MSG-A2", monthlyRent: 5000, capacity: 3,
    }, ownerAToken)).json?.data;
  }

  // Tenant A and Tenant B with active leases on Owner A
  let t = await req("POST", "/api/owner/tenants", {
    name: "Msg Tenant A", email: TENANT_A_EMAIL, phone: "09123450003", password: PW, roomId: roomA1?.id,
  }, ownerAToken);
  assert("Tenant A created", t.status === 201, `status=${r.status}`);
  tenantAId = userId(t);
  t = await req("POST", "/api/auth/login", { email: TENANT_A_EMAIL, password: PW });
  assert("Tenant A logs in", t.status === 200, `status=${t.status}`);
  tenantAToken = loginToken(t);

  t = await req("POST", "/api/owner/tenants", {
    name: "Msg Tenant B", email: TENANT_B_EMAIL, phone: "09123450004", password: PW, roomId: roomA2?.id,
  }, ownerAToken);
  assert("Tenant B created", t.status === 201, `status=${r.status}`);
  tenantBId = userId(t);
  t = await req("POST", "/api/auth/login", { email: TENANT_B_EMAIL, password: PW });
  assert("Tenant B logs in", t.status === 200, `status=${t.status}`);
  tenantBToken = loginToken(t);

  // Admin
  r = await req("POST", "/api/auth/login", { email: "admin@pagdagusan.com", password: "Admin123!" });
  adminToken = loginToken(r);
  if (adminToken) console.log("  INFO  Admin token acquired");
  else console.log("  WARN  Admin login unavailable, skipping admin assertions");
}

// ─── Test 1: Unauthenticated → 401 ─────────────────────
async function testUnauthenticated() {
  console.log("\n=== TEST 1: Unauthenticated (401) ===");
  const r1 = await req("GET", "/api/messages/conversations", null, null);
  assert("GET /conversations without token → 401", r1.status === 401, `status=${r1.status}`);

  const r2 = await req("POST", "/api/messages", { receiverId: ownerAId, message: "hi" }, null);
  assert("POST / without token → 401", r2.status === 401, `status=${r2.status}`);

  const r3 = await req("PATCH", "/api/messages/00000000-0000-0000-0000-000000000000/read", null, null);
  assert("PATCH /:id/read without token → 401", r3.status === 401, `status=${r3.status}`);

  const r4 = await req("GET", "/api/messages/unread-count", null, null);
  assert("GET /unread-count without token → 401", r4.status === 401, `status=${r4.status}`);
}

// ─── Test 2: Admin → 403 ───────────────────────────────
async function testAdminBlocked() {
  console.log("\n=== TEST 2: Admin blocked (403) ===");
  if (!adminToken) { console.log("  SKIP  No admin token"); return; }

  const r1 = await req("GET", "/api/messages/conversations", null, adminToken);
  assert("Admin GET /conversations → 403", r1.status === 403, `status=${r1.status}`);

  const r2 = await req("POST", "/api/messages", { receiverId: tenantAId, message: "test" }, adminToken);
  assert("Admin POST / → 403", r2.status === 403, `status=${r2.status}`);

  const r3 = await req("PATCH", "/api/messages/00000000-0000-0000-0000-000000000000/read", null, adminToken);
  assert("Admin PATCH /:id/read → 403", r3.status === 403, `status=${r3.status}`);

  const r4 = await req("GET", "/api/messages/unread-count", null, adminToken);
  assert("Admin GET /unread-count → 403", r4.status === 403, `status=${r4.status}`);
}

// ─── Test 3: Relationship authorization ─────────────────
async function testRelationshipAuth() {
  console.log("\n=== TEST 3: Relationship authorization ===");

  // Owner A → Tenant A (authorized) → 201
  let r = await req("POST", "/api/messages", { receiverId: tenantAId, message: "Hello Tenant A from Owner A" }, ownerAToken);
  assert("Owner A → Tenant A (related) → 201", r.status === 201, `status=${r.status}`);
  msgAtoB = r.json?.data;

  // Tenant A → Owner A (authorized) → 201
  r = await req("POST", "/api/messages", { receiverId: ownerAId, message: "Hello Owner A from Tenant A" }, tenantAToken);
  assert("Tenant A → Owner A (related) → 201", r.status === 201, `status=${r.status}`);
  msgBtoA = r.json?.data;

  // Owner A → Tenant B (authorized) → 201
  r = await req("POST", "/api/messages", { receiverId: tenantBId, message: "Hello Tenant B from Owner A" }, ownerAToken);
  assert("Owner A → Tenant B (related) → 201", r.status === 201, `status=${r.status}`);
  msgOwnerAToTenantB = r.json?.data;

  // Owner B → Tenant A (NOT related) → 403
  r = await req("POST", "/api/messages", { receiverId: tenantAId, message: "Owner B to unrelated tenant" }, ownerBToken);
  assert("Owner B → Tenant A (unrelated) → 403", r.status === 403, `status=${r.status}`);

  // Tenant A → Owner B (NOT related) → 403
  r = await req("POST", "/api/messages", { receiverId: ownerBId, message: "Tenant A to unrelated owner" }, tenantAToken);
  assert("Tenant A → Owner B (unrelated) → 403", r.status === 403, `status=${r.status}`);

  // Thread access is also blocked for unrelated users (not just sending).
  r = await req("GET", `/api/messages/conversations/${tenantAId}`, null, ownerBToken);
  assert("Owner B reads Owner A's tenant thread → 403", r.status === 403, `status=${r.status}`);

  r = await req("GET", `/api/messages/conversations/${tenantBId}`, null, tenantAToken);
  assert("Tenant A reads Tenant B's thread → 403", r.status === 403, `status=${r.status}`);

  // Verify thread for Owner A ↔ Tenant A shows both messages
  r = await req("GET", `/api/messages/conversations/${tenantAId}`, null, ownerAToken);
  assert("Owner A reads thread with Tenant A → 200", r.status === 200, `status=${r.status}`);
  const msgs = r.json?.data?.messages ?? [];
  assert("Thread has 2 messages", msgs.length === 2, `count=${msgs.length}`);
  assert("Messages sorted ascending", msgs.length === 2 && msgs[0].createdAt <= msgs[1].createdAt, "");
}

// ─── Test 4: Validation (400) ──────────────────────────
async function testValidation() {
  console.log("\n=== TEST 4: Validation (400) ===");

  // Empty message
  let r = await req("POST", "/api/messages", { receiverId: tenantAId, message: "" }, ownerAToken);
  assert("Empty message → 400", r.status === 400, `status=${r.status}`);

  // Whitespace only
  r = await req("POST", "/api/messages", { receiverId: tenantAId, message: "   " }, ownerAToken);
  assert("Whitespace-only message → 400", r.status === 400, `status=${r.status}`);

  // Self-send
  r = await req("POST", "/api/messages", { receiverId: ownerAId, message: "self message" }, ownerAToken);
  assert("Self-send → 400", r.status === 400, `status=${r.status}`);

  // Missing receiverId
  r = await req("POST", "/api/messages", { message: "no receiver" }, ownerAToken);
  assert("Missing receiverId → 400", r.status === 400, `status=${r.status}`);

  // Missing message field
  r = await req("POST", "/api/messages", { receiverId: tenantAId }, ownerAToken);
  assert("Missing message field → 400", r.status === 400, `status=${r.status}`);

  // Invalid receiverId UUID
  r = await req("POST", "/api/messages", { receiverId: "not-a-uuid", message: "hi" }, ownerAToken);
  assert("Invalid receiverId UUID → 400", r.status === 400, `status=${r.status}`);

  // Message > 2000 chars
  r = await req("POST", "/api/messages", { receiverId: tenantAId, message: "x".repeat(2001) }, ownerAToken);
  assert("Message > 2000 chars → 400", r.status === 400, `status=${r.status}`);

  // Non-existent receiver UUID
  r = await req("POST", "/api/messages", { receiverId: "00000000-0000-0000-0000-000000000000", message: "hi" }, ownerAToken);
  assert("Non-existent receiver → 404", r.status === 404, `status=${r.status}`);
}

// ─── Test 5: Unread count ──────────────────────────────
async function testUnreadCount() {
  console.log("\n=== TEST 5: Unread count ===");

  // Owner A should have 1 unread (Tenant B reply not yet sent; Tenant A's msg is read from thread open)
  let r = await req("GET", "/api/messages/unread-count", null, ownerAToken);
  assert("Owner A gets unread count → 200", r.status === 200, `status=${r.status}`);
  const ownerUnreadBefore = r.json?.data?.unreadCount ?? 0;
  assert("Owner A unread count is number", typeof ownerUnreadBefore === "number", `type=${typeof ownerUnreadBefore}`);

  // Tenant A should have 1 unread: only Owner A opened the thread in test 3,
  // which marks Tenant A → Owner A messages read on Owner A's side. Owner A → Tenant A
  // remains unread until Tenant A opens the conversation.
  r = await req("GET", "/api/messages/unread-count", null, tenantAToken);
  assert("Tenant A gets unread count → 200", r.status === 200, `status=${r.status}`);
  const tenantUnread = r.json?.data?.unreadCount ?? 0;
  assert("Tenant A unread = 1 (Owner A's message still unread)", tenantUnread === 1, `count=${tenantUnread}`);
}

// ─── Test 6: Conversation list ─────────────────────────
async function testConversations() {
  console.log("\n=== TEST 6: Conversation list ===");

  // Owner A should see conversations with Tenant A and Tenant B
  let r = await req("GET", "/api/messages/conversations", null, ownerAToken);
  assert("Owner A GET /conversations → 200", r.status === 200, `status=${r.status}`);
  const convs = r.json?.data ?? [];
  const counterpartIds = convs.map((c) => c.counterpartId);
  assert("Owner A sees Tenant A in conversations", counterpartIds.includes(tenantAId), `ids=${counterpartIds}`);
  assert("Owner A sees Tenant B in conversations", counterpartIds.includes(tenantBId), `ids=${counterpartIds}`);

  // Each conversation has correct shape
  const convA = convs.find((c) => c.counterpartId === tenantAId);
  assert("Conversation has counterpartName", !!convA?.counterpartName, `name=${convA?.counterpartName}`);
  assert("Conversation has unreadCount", typeof convA?.unreadCount === "number", "");
  assert("Conversation has lastMessage", !!convA?.lastMessage?.content, "");

  // Tenant A should see conversation with Owner A
  r = await req("GET", "/api/messages/conversations", null, tenantAToken);
  assert("Tenant A GET /conversations → 200", r.status === 200, `status=${r.status}`);
  const tenantConvs = r.json?.data ?? [];
  assert("Tenant A sees Owner A", tenantConvs.some((c) => c.counterpartId === ownerAId), "");

  // No cross-contamination: Tenant A conversations do NOT include Tenant B
  assert("Tenant A has no Tenant B in conversations",
    !tenantConvs.some((c) => c.counterpartId === tenantBId), "");
}

// ─── Test 6b: Sender / property spoofing is ignored ────
async function testSpoofing() {
  console.log("\n=== TEST 6b: Spoofing is ignored ===");

  // Client tries to spoof the sender. The backend must attribute the message
  // to req.user.userId (Owner A), never to the spoofed id.
  const spoofSender = await req("POST", "/api/messages", {
    senderId: tenantBId,
    receiverId: tenantAId,
    message: "spoofed sender check",
  }, ownerAToken);
  assert("POST with spoofed senderId → 201", spoofSender.status === 201, `status=${spoofSender.status}`);
  assert("Message attributed to authenticated sender",
    spoofSender.json?.data?.senderId === ownerAId,
    `sender=${spoofSender.json?.data?.senderId}`);

  // Client tries to spoof the property. Relationship must come from the DB,
  // and the message still lands in the Owner A ↔ Tenant A conversation.
  const spoofProp = await req("POST", "/api/messages", {
    receiverId: tenantAId,
    propertyId: "00000000-0000-0000-0000-000000000000",
    message: "spoofed property check",
  }, ownerAToken);
  assert("POST with spoofed propertyId → 201", spoofProp.status === 201, `status=${spoofProp.status}`);

  // Verify both spoofed messages landed in the legitimate Owner A ↔ Tenant A thread.
  const thread = await req("GET", `/api/messages/conversations/${tenantAId}`, null, ownerAToken);
  const contents = (thread.json?.data?.messages ?? []).map((m) => m.content);
  assert("Spoofed sender message visible in Owner A ↔ Tenant A thread",
    contents.includes("spoofed sender check"), `contents=${JSON.stringify(contents)}`);
  assert("Spoofed property message visible in Owner A ↔ Tenant A thread",
    contents.includes("spoofed property check"), `contents=${JSON.stringify(contents)}`);
}

// ─── Test 7: Thread read-marking ───────────────────────
async function testThreadReadMarking() {
  console.log("\n=== TEST 7: Thread read-marking ===");

  // Owner A opens thread with Tenant B — should mark Tenant B's message as read
  // First send another message from Tenant B so there's an unread
  let r = await req("POST", "/api/messages", { receiverId: ownerAId, message: "Tenant B follow-up" }, tenantBToken);
  assert("Tenant B sends follow-up to Owner A → 201", r.status === 201, `status=${r.status}`);

  // Owner A unread count > 0 now
  r = await req("GET", "/api/messages/unread-count", null, ownerAToken);
  const beforeCount = r.json?.data?.unreadCount ?? 0;
  assert("Owner A unread > 0 before opening thread", beforeCount > 0, `count=${beforeCount}`);

  // Owner A opens thread with Tenant B (marks Tenant B's message as read)
  r = await req("GET", `/api/messages/conversations/${tenantBId}`, null, ownerAToken);
  assert("Owner A opens Tenant B thread → 200", r.status === 200, `status=${r.status}`);
  const threadMsgs = r.json?.data?.messages ?? [];
  assert("Thread has at least 2 messages", threadMsgs.length >= 2, `count=${threadMsgs.length}`);

  // Owner A unread count should decrease
  r = await req("GET", "/api/messages/unread-count", null, ownerAToken);
  const afterCount = r.json?.data?.unreadCount ?? 0;
  assert("Owner A unread decreased after opening thread", afterCount < beforeCount, `before=${beforeCount}, after=${afterCount}`);

  // Positive case: Tenant A can read their own thread with Owner A.
  r = await req("GET", `/api/messages/conversations/${ownerAId}`, null, tenantAToken);
  assert("Tenant A reads own thread with owner → 200", r.status === 200, `status=${r.status}`);
}

// ─── Test 8: PATCH /:id/read ───────────────────────────
async function testPatchRead() {
  console.log("\n=== TEST 8: PATCH /:id/read ===");

  if (!msgAtoB) { console.log("  SKIP  No message to mark"); return; }

  // Tenant A is the receiver of msgAtoB (Owner A sent it)
  // Tenant A marks it read → 200
  let r = await req("PATCH", `/api/messages/${msgAtoB.id}/read`, null, tenantAToken);
  assert("Receiver marks message read → 200", r.status === 200, `status=${r.status}`);

  // Idempotent — second call still 200
  r = await req("PATCH", `/api/messages/${msgAtoB.id}/read`, null, tenantAToken);
  assert("Second PATCH read (idempotent) → 200", r.status === 200, `status=${r.status}`);

  // Sender tries to mark read → 403 (only receiver can mark)
  r = await req("PATCH", `/api/messages/${msgAtoB.id}/read`, null, ownerAToken);
  assert("Sender tries to mark read → 403", r.status === 403, `status=${r.status}`);

  // Non-participant tries → 404
  r = await req("PATCH", `/api/messages/${msgAtoB.id}/read`, null, tenantBToken);
  assert("Non-participant tries PATCH → 404", r.status === 404, `status=${r.status}`);

  // Non-existent message ID → 404
  r = await req("PATCH", "/api/messages/00000000-0000-0000-0000-000000000000/read", null, tenantAToken);
  assert("PATCH non-existent message → 404", r.status === 404, `status=${r.status}`);

  // Bad UUID → 400
  r = await req("PATCH", "/api/messages/not-a-uuid/read", null, tenantAToken);
  assert("PATCH invalid UUID → 400", r.status === 400, `status=${r.status}`);
}

// ─── Test 9: Thread conversation endpoint edge cases ───
async function testThreadEdgeCases() {
  console.log("\n=== TEST 9: Thread edge cases ===");

  // Missing query param → 400
  let r = await req("GET", "/api/messages/conversations/does-not-matter", null, ownerAToken);
  // This is actually /conversations/:userId — we need to test bad UUID
  r = await req("GET", "/api/messages/conversations/not-a-uuid", null, ownerAToken);
  assert("Thread with invalid UUID → 400", r.status === 400, `status=${r.status}`);

  // Thread with non-existent user → 404
  r = await req("GET", "/api/messages/conversations/00000000-0000-0000-0000-000000000000", null, ownerAToken);
  assert("Thread with non-existent user → 404", r.status === 404, `status=${r.status}`);
}

// ─── Cleanup ────────────────────────────────────────────
async function cleanup() {
  console.log("\n=== CLEANUP ===");
  const pool = require("./db");
  try {
    await pool.query(
      `DELETE FROM messages WHERE sender_id = ANY($1::uuid[]) OR receiver_id = ANY($1::uuid[])`,
      [[ownerAId, ownerBId, tenantAId, tenantBId].filter(Boolean)]
    );
    await pool.query(
      `DELETE FROM leases WHERE tenant_id IN (
         SELECT id FROM users WHERE email = ANY($1::text[]))`,
      [[TENANT_A_EMAIL, TENANT_B_EMAIL]]
    );
    if (roomA1) await pool.query("DELETE FROM rooms WHERE id = $1", [roomA1.id]);
    if (roomA2) await pool.query("DELETE FROM rooms WHERE id = $1", [roomA2.id]);
    await pool.query(`DELETE FROM properties WHERE name LIKE 'Msg Test Dorm %'`);
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
    await testUnauthenticated();
    await testAdminBlocked();
    await testRelationshipAuth();
    await testValidation();
    await testUnreadCount();
    await testConversations();
    await testSpoofing();
    await testThreadReadMarking();
    await testPatchRead();
    await testThreadEdgeCases();
  } catch (err) {
    console.error("\nFATAL:", err);
    failed++;
  } finally {
    await cleanup();
  }

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
})();
