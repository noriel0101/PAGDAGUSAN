/**
 * Notification System Integration Test
 *
 * Covers the capstone notification flow end to end:
 *   reservation requested / approved / rejected, payments, maintenance,
 *   messages, announcements, owner registration, plus the notification API
 *   itself (list, unread count, mark read, mark all read) and the role
 *   isolation rules.
 *
 * Requires: server running on :5000 with the admin@pagdagusan.com account.
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

// ─── Setup ────────────────────────────────────────────────
const STAMP = Date.now();
const ADMIN_EMAIL = "admin@pagdagusan.com";
const ADMIN_PW = "Admin123!";

const OWNER_EMAIL = `notif_owner_${STAMP}@test.com`;
const OWNER2_EMAIL = `notif_owner2_${STAMP}@test.com`;
const TENANT_EMAIL = `notif_tenant_${STAMP}@test.com`;
const TENANT2_EMAIL = `notif_tenant2_${STAMP}@test.com`;
const PW = "Test1234!";

let adminToken;
let ownerToken, owner2Token, tenantToken, tenant2Token;
let ownerId, owner2Id, tenantId, tenant2Id;
let property, room;

async function setup() {
  console.log("\n=== SETUP ===");
  const pool = require("./db");
  const bcrypt = require("bcryptjs");

  // Clear any notifications left by earlier runs so counts are deterministic.
  await pool.query("DELETE FROM notifications");
  console.log("  INFO  notifications table cleared");

  let r = await req("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PW });
  adminToken = loginToken(r);
  assert("Admin logs in", !!adminToken, `status=${r.status}`);

  // ── Owner registration notifies admins ──────────────────
  r = await req("POST", "/api/auth/register-owner", {
    name: "Notif Test Owner", email: OWNER_EMAIL, phone: "09100000001", password: PW,
  });
  assert("Owner registered", r.status === 201, `status=${r.status} ${r.json?.message}`);
  ownerId = r.json?.data?.id;

  const adminNotifs = await req("GET", "/api/notifications", null, adminToken);
  const regNotif = adminNotifs.json?.data?.find((n) => n.type === "owner_registered");
  assert("Admin notified of owner registration", !!regNotif, `count=${adminNotifs.json?.count}`);
  assert(
    "Registration notification targets the new owner",
    regNotif?.relatedId === ownerId && regNotif?.relatedType === "owner",
    `relatedId=${regNotif?.relatedId}`
  );

  // Approve the owner → owner is notified
  r = await req("PATCH", `/api/admin/owners/${ownerId}/approve`, {}, adminToken);
  assert("Admin approves owner", r.status === 200, `status=${r.status} ${r.json?.message}`);

  await pool.query(`UPDATE users SET status = 'active' WHERE id = $1`, [ownerId]);
  r = await req("POST", "/api/auth/login", { email: OWNER_EMAIL, password: PW });
  ownerToken = loginToken(r);
  assert("Owner logs in", !!ownerToken, `status=${r.status}`);

  const ownerNotifs = await req("GET", "/api/notifications", null, ownerToken);
  const approvedNotif = ownerNotifs.json?.data?.find((n) => n.type === "owner_approved");
  assert("Owner notified of approval", !!approvedNotif, `count=${ownerNotifs.json?.count}`);
  assert("Approval notification starts unread", approvedNotif?.isRead === false);

  // ── A second owner, to prove notifications are NOT broadcast ──
  r = await req("POST", "/api/auth/register-owner", {
    name: "Notif Other Owner", email: OWNER2_EMAIL, phone: "09100000002", password: PW,
  });
  owner2Id = r.json?.data?.id;
  await pool.query(`UPDATE users SET status = 'active' WHERE id = $1`, [owner2Id]);
  r = await req("POST", "/api/auth/login", { email: OWNER2_EMAIL, password: PW });
  owner2Token = loginToken(r);
  assert("Second owner logs in", !!owner2Token, `status=${r.status}`);

  // ── Property + room ──────────────────────────────────────
  r = await req("POST", "/api/owner/properties", {
    name: "Notif Test Dorm", address: "100 Test Ave", contactNumber: "09170000000",
  }, ownerToken);
  assert("Owner creates property", r.status === 201, `status=${r.status} ${r.json?.message}`);
  property = r.json?.data;

  r = await req("POST", "/api/owner/rooms", {
    propertyId: property.id, roomNumber: "N-101", monthlyRent: 5500, capacity: 1,
  }, ownerToken);
  assert("Owner creates available room", r.status === 201, `status=${r.status} ${r.json?.message}`);
  room = r.json?.data;

  // ── Tenant ───────────────────────────────────────────────
  const hash = await bcrypt.hash(PW, 12);
  await pool.query(
    `INSERT INTO users (name, email, phone, password_hash, role, status, email_verified)
     VALUES ($1, $2, $3, $4, 'tenant', 'active', true)`,
    ["Francis Quintinita", TENANT_EMAIL, "09200000001", hash]
  );
  const t = await pool.query(`SELECT id FROM users WHERE email = $1`, [TENANT_EMAIL]);
  tenantId = t.rows[0].id;

  r = await req("POST", "/api/auth/login", { email: TENANT_EMAIL, password: PW });
  tenantToken = loginToken(r);
  assert("Tenant logs in", !!tenantToken, `status=${r.status}`);

  // A second tenant: a tenant may only hold one active lease, so the rejection
  // path needs a different applicant.
  await pool.query(
    `INSERT INTO users (name, email, phone, password_hash, role, status, email_verified)
     VALUES ($1, $2, $3, $4, 'tenant', 'active', true)`,
    ["Marco Dela Cruz", TENANT2_EMAIL, "09200000002", hash]
  );
  const t2 = await pool.query(`SELECT id FROM users WHERE email = $1`, [TENANT2_EMAIL]);
  tenant2Id = t2.rows[0].id;

  r = await req("POST", "/api/auth/login", { email: TENANT2_EMAIL, password: PW });
  tenant2Token = loginToken(r);
  assert("Second tenant logs in", !!tenant2Token, `status=${r.status}`);
}

// ─── The capstone scenario (spec §18) ─────────────────────
let reservationId;
let ownerReservationNotification;

async function testTenantAppliesNotifiesOwner() {
  console.log("\n=== CASE 1: Tenant applies → owner notified ===");

  // Browse the dorm exactly as the app does, then apply.
  const browse = await req("GET", `/api/properties/${property.id}`);
  assert("Tenant can view the property", browse.status === 200, `status=${browse.status}`);

  const rooms = await req("GET", `/api/properties/${property.id}/rooms`);
  assert("Available room is listed", rooms.json?.data?.some((x) => x.id === room.id));

  const before = await req("GET", "/api/notifications/unread-count", null, ownerToken);
  const beforeCount = before.json?.count;

  const r = await req("POST", "/api/tenant/reservations", {
    room_id: room.id,
    move_in_date: "2026-10-01",
    message: "Looking forward to moving in",
  }, tenantToken);
  assert("Reservation created", r.status === 201, `status=${r.status} ${r.json?.message}`);
  reservationId = r.json?.data?.id;
  assert("Status is pending_approval", r.json?.data?.status === "pending_approval");

  // The owner is notified
  const list = await req("GET", "/api/notifications", null, ownerToken);
  ownerReservationNotification = list.json?.data?.find(
    (n) => n.type === "reservation_requested" && n.relatedId === reservationId
  );
  assert("Owner received the reservation notification", !!ownerReservationNotification);
  assert(
    "Notification title matches spec",
    ownerReservationNotification?.title === "New Reservation Request",
    `title=${ownerReservationNotification?.title}`
  );
  assert(
    "Notification message names the tenant and room",
    /Francis Quintinita/.test(ownerReservationNotification?.message || "") &&
      /N-101/.test(ownerReservationNotification?.message || "") &&
      /Notif Test Dorm/.test(ownerReservationNotification?.message || ""),
    `message=${ownerReservationNotification?.message}`
  );
  assert(
    "Notification carries reservation related record",
    ownerReservationNotification?.relatedType === "reservation" &&
      ownerReservationNotification?.relatedId === reservationId
  );

  // Unread count drives the bell badge
  const after = await req("GET", "/api/notifications/unread-count", null, ownerToken);
  assert("Owner unread count increased", after.json?.count === beforeCount + 1,
    `before=${beforeCount} after=${after.json?.count}`);

  // The other owner must NOT have been notified
  const other = await req("GET", "/api/notifications", null, owner2Token);
  const leaked = other.json?.data?.some((n) => n.relatedId === reservationId);
  assert("Notification is not broadcast to other owners", !leaked);

  // The tenant is not notified about their own request
  const tenantList = await req("GET", "/api/notifications", null, tenantToken);
  assert(
    "Tenant is not notified of their own request",
    !tenantList.json?.data?.some((n) => n.relatedId === reservationId)
  );
}

async function testMarkReadAndIsolation() {
  console.log("\n=== CASE 2: Mark as read + cross-user isolation ===");

  const id = ownerReservationNotification.id;

  const r = await req("PATCH", `/api/notifications/${id}/read`, {}, ownerToken);
  assert("Owner marks notification read", r.status === 200, `status=${r.status}`);
  assert("Response marks it read", r.json?.data?.isRead === true);
  assert("readAt is set", !!r.json?.data?.readAt);
  assert("Response returns refreshed unread count", typeof r.json?.unreadCount === "number");

  // A different user must not be able to touch it.
  const cross = await req("PATCH", `/api/notifications/${id}/read`, {}, tenantToken);
  assert("Another user cannot mark it read (404)", cross.status === 404, `status=${cross.status}`);

  const crossOwner = await req("PATCH", `/api/notifications/${id}/read`, {}, owner2Token);
  assert("Other owner cannot mark it read (404)", crossOwner.status === 404, `status=${crossOwner.status}`);
}

async function testOwnerApprovesNotifiesTenant() {
  console.log("\n=== CASE 3: Owner approves → tenant notified ===");

  const list = await req("GET", "/api/owner/reservations", null, ownerToken);
  const item = list.json?.data?.find((x) => x.id === reservationId);
  assert("Owner sees the reservation in their queue", !!item, `count=${list.json?.count}`);

  const r = await req("POST", `/api/owner/reservations/${reservationId}/approve`, {}, ownerToken);
  assert("Owner approves reservation", r.status === 200, `status=${r.status} ${r.json?.message}`);

  const tenantNotifs = await req("GET", "/api/notifications", null, tenantToken);
  const approved = tenantNotifs.json?.data?.find(
    (n) => n.type === "reservation_approved" && n.relatedId === reservationId
  );
  assert("Tenant received approval notification", !!approved);
  assert("Title matches spec", approved?.title === "Reservation Approved", `title=${approved?.title}`);
  assert(
    "Message names the room and property",
    /N-101/.test(approved?.message || "") && /Notif Test Dorm/.test(approved?.message || ""),
    `message=${approved?.message}`
  );
  assert("Related record is the reservation", approved?.relatedType === "reservation");

  const detail = await req("GET", `/api/tenant/reservations/${reservationId}`, null, tenantToken);
  assert("Tenant can open the approved reservation", detail.status === 200, `status=${detail.status}`);
  assert("Reservation is active", detail.json?.data?.status === "active", `status=${detail.json?.data?.status}`);
}

async function testOwnerRejectsNotifiesTenant() {
  console.log("\n=== CASE 4: Owner rejects → tenant notified ===");

  const room2 = await req("POST", "/api/owner/rooms", {
    propertyId: property.id, roomNumber: "N-102", monthlyRent: 5000, capacity: 1,
  }, ownerToken);
  const room2Id = room2.json?.data?.id;

  const res = await req("POST", "/api/tenant/reservations", {
    room_id: room2Id, move_in_date: "2026-11-01", message: "Second application",
  }, tenant2Token);
  assert("Second reservation created", res.status === 201, `status=${res.status} ${res.json?.message}`);
  const reservationId2 = res.json?.data?.id;

  const r = await req("POST", `/api/owner/reservations/${reservationId2}/reject`, {
    reason: "Room already reserved for another applicant",
  }, ownerToken);
  assert("Owner rejects reservation", r.status === 200, `status=${r.status} ${r.json?.message}`);

  const tenantNotifs = await req("GET", "/api/notifications", null, tenant2Token);
  const rejected = tenantNotifs.json?.data?.find(
    (n) => n.type === "reservation_rejected" && n.relatedId === reservationId2
  );
  assert("Tenant received rejection notification", !!rejected);
  assert("Title is 'Reservation Rejected'", rejected?.title === "Reservation Rejected", `title=${rejected?.title}`);
  assert("Message includes the reason", /already reserved/.test(rejected?.message || ""),
    `message=${rejected?.message}`);

  // The tenant who was NOT involved must not see the rejection.
  const other = await req("GET", "/api/notifications", null, tenantToken);
  assert("Unrelated tenant is not notified of the rejection",
    !other.json?.data?.some((n) => n.relatedId === reservationId2));
}

async function testPaymentNotifications() {
  console.log("\n=== CASE 5: Payment notifications ===");

  const payment = await req("POST", "/api/tenant/payments", {
    amount: 5500, paymentMethod: "cash",
    referenceNumber: `REF-${STAMP}`, notes: "First month",
  }, tenantToken);
  assert("Tenant submits payment", payment.status === 201, `status=${payment.status} ${payment.json?.message}`);
  const paymentId = payment.json?.data?.id;

  const ownerNotifs = await req("GET", "/api/notifications", null, ownerToken);
  const submitted = ownerNotifs.json?.data?.find(
    (n) => n.type === "payment_submitted" && n.relatedId === paymentId
  );
  assert("Owner notified of payment submission", !!submitted);
  assert("Message shows the amount", /5,?500/.test(submitted?.message || ""), `message=${submitted?.message}`);

  const verify = await req("PATCH", `/api/owner/payments/${paymentId}/verify`, {}, ownerToken);
  assert("Owner verifies payment", verify.status === 200, `status=${verify.status} ${verify.json?.message}`);

  const tenantNotifs = await req("GET", "/api/notifications", null, tenantToken);
  const verified = tenantNotifs.json?.data?.find(
    (n) => n.type === "payment_verified" && n.relatedId === paymentId
  );
  assert("Tenant notified of payment verification", !!verified);
  assert("Title is 'Payment Verified'", verified?.title === "Payment Verified", `title=${verified?.title}`);

  // Rejection path
  const payment2 = await req("POST", "/api/tenant/payments", {
    amount: 500, paymentMethod: "cash", referenceNumber: `REF2-${STAMP}`,
  }, tenantToken);
  const paymentId2 = payment2.json?.data?.id;

  const reject = await req("PATCH", `/api/owner/payments/${paymentId2}/reject`, {
    reason: "Amount does not match the monthly rent",
  }, ownerToken);
  assert("Owner rejects payment", reject.status === 200, `status=${reject.status} ${reject.json?.message}`);

  const after = await req("GET", "/api/notifications", null, tenantToken);
  const rejected = after.json?.data?.find((n) => n.type === "payment_rejected" && n.relatedId === paymentId2);
  assert("Tenant notified of payment rejection", !!rejected);
  assert("Title is 'Payment Rejected'", rejected?.title === "Payment Rejected", `title=${rejected?.title}`);
}

async function testMaintenanceNotifications() {
  console.log("\n=== CASE 6: Maintenance notifications ===");

  const created = await req("POST", "/api/tenant/maintenance", {
    title: "Broken shower heater",
    description: "The shower in the bathroom does not heat up.",
    category: "electrical", priority: "high",
  }, tenantToken);
  assert("Tenant files maintenance request", created.status === 201, `status=${created.status} ${created.json?.message}`);
  const maintenanceId = created.json?.data?.id;

  const ownerNotifs = await req("GET", "/api/notifications", null, ownerToken);
  const createdNotif = ownerNotifs.json?.data?.find(
    (n) => n.type === "maintenance_created" && n.relatedId === maintenanceId
  );
  assert("Owner notified of maintenance request", !!createdNotif);
  assert("Message names the request", /Broken shower heater/.test(createdNotif?.message || ""),
    `message=${createdNotif?.message}`);

  // Maintenance follows the state machine: pending -> reviewing -> in_progress
  const reviewing = await req("PATCH", `/api/owner/maintenance/${maintenanceId}/status`, {
    status: "reviewing",
  }, ownerToken);
  assert("Owner moves request to reviewing", reviewing.status === 200, `status=${reviewing.status} ${reviewing.json?.message}`);

  const updated = await req("PATCH", `/api/owner/maintenance/${maintenanceId}/status`, {
    status: "in_progress",
  }, ownerToken);
  assert("Owner changes maintenance status", updated.status === 200, `status=${updated.status} ${updated.json?.message}`);

  const tenantNotifs = await req("GET", "/api/notifications", null, tenantToken);
  const updatedNotif = tenantNotifs.json?.data?.find(
    (n) => n.type === "maintenance_updated" && n.relatedId === maintenanceId
  );
  assert("Tenant notified of maintenance status change", !!updatedNotif);
  assert("Message uses the human status label", /in progress/.test(updatedNotif?.message || ""),
    `message=${updatedNotif?.message}`);
}

async function testMessageAndAnnouncementNotifications() {
  console.log("\n=== CASE 7: Message + announcement notifications ===");

  const sent = await req("POST", "/api/messages", {
    receiverId: ownerId, message: "Hi sir, when can I move in?",
  }, tenantToken);
  assert("Tenant sends a message", sent.status === 201, `status=${sent.status} ${sent.json?.message}`);

  const ownerNotifs = await req("GET", "/api/notifications", null, ownerToken);
  const msgNotif = ownerNotifs.json?.data?.find((n) => n.type === "message_received");
  assert("Owner notified of the message", !!msgNotif);
  assert("Message notification previews the content", /when can I move in/.test(msgNotif?.message || ""),
    `message=${msgNotif?.message}`);

  const announcement = await req("POST", "/api/owner/announcements", {
    title: "Water shutoff on Friday",
    content: "Water will be unavailable from 9am to 1pm on Friday.",
    propertyId: property.id,
  }, ownerToken);
  assert("Owner creates announcement", announcement.status === 201, `status=${announcement.status} ${announcement.json?.message}`);
  const announcementId = announcement.json?.data?.id;

  const published = await req("PATCH", `/api/owner/announcements/${announcementId}/publish`, {}, ownerToken);
  assert("Owner publishes announcement", published.status === 200, `status=${published.status} ${published.json?.message}`);

  const tenantNotifs = await req("GET", "/api/notifications", null, tenantToken);
  const annNotif = tenantNotifs.json?.data?.find(
    (n) => n.type === "announcement_published" && n.relatedId === announcementId
  );
  assert("Tenant notified of the announcement", !!annNotif, `types=${(tenantNotifs.json?.data || []).map((n) => n.type).join(",")}`);
  assert("Message carries the announcement title", /Water shutoff/.test(annNotif?.message || ""),
    `message=${annNotif?.message}`);
}

async function testNotificationApiBehaviour() {
  console.log("\n=== CASE 8: Notification API behaviour ===");

  // Unauthenticated
  const anon = await req("GET", "/api/notifications");
  assert("Notifications require authentication (401)", anon.status === 401, `status=${anon.status}`);

  // Listing
  const list = await req("GET", "/api/notifications", null, tenantToken);
  assert("Tenant lists their notifications", list.status === 200, `status=${list.status}`);
  assert("Response is ordered newest first", isDescending(list.json?.data || []));
  assert("Response count matches the rows", list.json?.count === list.json?.data?.length);
  assert(
    "Payload uses the camelCase client shape",
    list.json?.data?.every(
      (n) =>
        "id" in n && "type" in n && "title" in n && "message" in n &&
        "isRead" in n && "createdAt" in n && "relatedType" in n
    )
  );

  // Filters
  const unread = await req("GET", "/api/notifications?unread=true", null, tenantToken);
  assert("unread=true filters to unread only",
    unread.json?.data?.every((n) => n.isRead === false), `count=${unread.json?.count}`);

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recent = await req("GET", `/api/notifications?since=${encodeURIComponent(since)}`, null, tenantToken);
  assert("since= filters to recent rows", recent.status === 200, `status=${recent.status}`);

  const badSince = await req("GET", "/api/notifications?since=not-a-date", null, tenantToken);
  assert("Invalid since is rejected (400)", badSince.status === 400, `status=${badSince.status}`);

  const limited = await req("GET", "/api/notifications?limit=1", null, tenantToken);
  assert("limit is honoured", limited.json?.data?.length === 1, `len=${limited.json?.data?.length}`);

  const overLimit = await req("GET", "/api/notifications?limit=99999", null, tenantToken);
  assert("limit is clamped to 100", overLimit.status === 200 && overLimit.json?.data?.length <= 100);

  // Mark all as read
  const before = await req("GET", "/api/notifications/unread-count", null, tenantToken);
  assert("Tenant has unread notifications", before.json?.count > 0, `count=${before.json?.count}`);

  const all = await req("PATCH", "/api/notifications/read-all", {}, tenantToken);
  assert("Mark all as read succeeds", all.status === 200, `status=${all.status}`);
  assert("Response reports how many were updated", all.json?.updated === before.json?.count,
    `updated=${all.json?.updated} expected=${before.json?.count}`);

  const after = await req("GET", "/api/notifications/unread-count", null, tenantToken);
  assert("Unread count is now zero", after.json?.count === 0, `count=${after.json?.count}`);

  // Marking all as read must not touch the owner's own notifications.
  const ownerStill = await req("GET", "/api/notifications/unread-count", null, ownerToken);
  assert("Other user's notifications are untouched", ownerStill.json?.count > 0,
    `ownerCount=${ownerStill.json?.count}`);

  // Unknown id
  const missing = await req("PATCH", "/api/notifications/00000000-0000-0000-0000-000000000000/read", {}, tenantToken);
  assert("Unknown notification id 404s", missing.status === 404, `status=${missing.status}`);
}

async function testTransactionSafety() {
  console.log("\n=== CASE 9: Transaction safety ===");

  // Applying for an occupied/unavailable room must fail AND create no notification.
  const pool = require("./db");
  const before = await req("GET", "/api/notifications/unread-count", null, ownerToken);

  // Create a room, occupy it, then attempt to apply to it.
  const room3 = await req("POST", "/api/owner/rooms", {
    propertyId: property.id, roomNumber: "N-103", monthlyRent: 4000, capacity: 1,
  }, ownerToken);
  const room3Id = room3.json?.data?.id;

  const occupant = await pool.query(
    `INSERT INTO leases (tenant_id, room_id, monthly_rent, status, start_date)
     VALUES ($1, $2, 4000, 'active', '2026-09-01')`,
    [tenant2Id, room3Id]
  );
  void occupant;

  const attempt = await req("POST", "/api/tenant/reservations", {
    room_id: room3Id, move_in_date: "2026-12-01",
  }, tenantToken);
  assert("Applying to an occupied room fails", attempt.status >= 400, `status=${attempt.status}`);

  const after = await req("GET", "/api/notifications/unread-count", null, ownerToken);
  assert("Failed reservation created no notification", after.json?.count === before.json?.count,
    `before=${before.json?.count} after=${after.json?.count}`);

  const list = await req("GET", "/api/notifications", null, ownerToken);
  assert("No notification references the failed room",
    !list.json?.data?.some((n) => n.message?.includes("N-103")));
}

function isDescending(rows) {
  for (let i = 1; i < rows.length; i++) {
    if (new Date(rows[i - 1].createdAt) < new Date(rows[i].createdAt)) return false;
  }
  return true;
}

// ─── Run ─────────────────────────────────────────────────
(async () => {
  try {
    await setup();
    await testTenantAppliesNotifiesOwner();
    await testMarkReadAndIsolation();
    await testOwnerApprovesNotifiesTenant();
    await testOwnerRejectsNotifiesTenant();
    await testPaymentNotifications();
    await testMaintenanceNotifications();
    await testMessageAndAnnouncementNotifications();
    await testNotificationApiBehaviour();
    await testTransactionSafety();

    console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
    process.exitCode = failed > 0 ? 1 : 0;
  } catch (error) {
    console.error("\nTEST RUN ERROR:", error);
    process.exitCode = 1;
  } finally {
    const pool = require("./db");
    await pool.end().catch(() => {});
  }
})();
