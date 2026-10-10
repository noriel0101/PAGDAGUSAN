// ─── Notification types ────────────────────────────────────────────────
// Every value written to notifications.type. The mobile client maps each one to
// an icon + accent colour in src/lib/notifications.ts, so adding a new value
// here only requires adding the matching UI entry there.
const NOTIFICATION_TYPES = {
  RESERVATION_REQUESTED: "reservation_requested",
  RESERVATION_APPROVED: "reservation_approved",
  RESERVATION_REJECTED: "reservation_rejected",
  PAYMENT_SUBMITTED: "payment_submitted",
  PAYMENT_VERIFIED: "payment_verified",
  PAYMENT_REJECTED: "payment_rejected",
  MAINTENANCE_CREATED: "maintenance_created",
  MAINTENANCE_UPDATED: "maintenance_updated",
  MESSAGE_RECEIVED: "message_received",
  ANNOUNCEMENT_PUBLISHED: "announcement_published",
  OWNER_REGISTERED: "owner_registered",
  OWNER_APPROVED: "owner_approved",
  OWNER_REJECTED: "owner_rejected",
  RATING_RECEIVED: "rating_received",
};

// related_type values. These are the existing PAGDAGUSAN record types, so the
// mobile app can open the correct screen from a notification tap.
const RELATED_TYPES = {
  RESERVATION: "reservation",
  PAYMENT: "payment",
  MAINTENANCE: "maintenance",
  MESSAGE: "message",
  ANNOUNCEMENT: "announcement",
  OWNER: "owner",
  RATING: "rating",
};

// Human labels for maintenance_status, used inside notification copy.
const MAINTENANCE_STATUS_LABELS = {
  pending: "pending review",
  reviewing: "under review",
  in_progress: "in progress",
  completed: "completed",
  cancelled: "cancelled",
};

// ─── Core insert ───────────────────────────────────────────────────────
// `executor` may be the shared pool (autocommit) or a checked-out client that
// is inside a BEGIN/COMMIT block, which is how the reservation, payment,
// maintenance, message and owner-registration flows keep the business record
// and its notification in the same transaction.
//
// The insert is wrapped in a SAVEPOINT on purpose: a notification must never be
// able to roll back (or fail) the business operation that triggered it. If the
// insert blows up we roll back only to the savepoint, log, and let the caller
// commit the real work.
const SAVEPOINT = "notification_insert_sp";

async function createNotification(executor, { recipientId, type, title, message, relatedId, relatedType }) {
  if (!recipientId || !type || !title || !message) {
    return null;
  }

  try {
    await executor.query(`SAVEPOINT ${SAVEPOINT}`);
    const result = await executor.query(
      `INSERT INTO notifications (recipient_id, type, title, message, related_id, related_type)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, recipient_id, type, title, message, related_id, related_type, is_read, created_at, read_at`,
      [recipientId, type, title, message, relatedId || null, relatedType || null]
    );
    await executor.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
    return result.rows[0] || null;
  } catch (error) {
    await executor.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`).catch(() => {});
    console.error("Create notification error:", error.message);
    return null;
  }
}

// Same as createNotification but for a single executor and many recipients
// (e.g. publishing an announcement reaches every tenant of the property).
async function createNotifications(executor, entries) {
  const created = [];
  for (const entry of entries) {
    const row = await createNotification(executor, entry);
    if (row) created.push(row);
  }
  return created;
}

// ─── Recipient lookups ─────────────────────────────────────────────────

// Every active admin. Used when a dorm owner registers.
async function listAdminIds(executor) {
  const result = await executor.query(
    `SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY created_at`
  );
  return result.rows.map((row) => row.id);
}

// Tenants holding an ACTIVE lease in one of the property's rooms. Used when an
// announcement is published so only genuinely affected tenants are notified.
async function listPropertyTenantIds(executor, propertyId) {
  const result = await executor.query(
    `SELECT DISTINCT l.tenant_id
     FROM leases l
     JOIN rooms r ON r.id = l.room_id
     WHERE r.property_id = $1 AND l.status = 'active'`,
    [propertyId]
  );
  return result.rows.map((row) => row.tenant_id);
}

// ─── Copy builders + emitters ─────────────────────────────────────────
// Wording lives here so every route produces the same phrasing for the same
// event, and so a copy change never requires touching route files.

function formatAmount(amount) {
  const value = Number(amount);
  return Number.isFinite(value) ? `₱${value.toLocaleString("en-PH")}` : "your payment";
}

function truncate(text, max) {
  const value = String(text || "").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

// 1. Tenant created a reservation → the OWNER OF THAT PROPERTY (never all owners).
async function notifyReservationRequested(executor, { ownerId, tenantName, roomNumber, propertyName, reservationId }) {
  return createNotification(executor, {
    recipientId: ownerId,
    type: NOTIFICATION_TYPES.RESERVATION_REQUESTED,
    title: "New Reservation Request",
    message: `${tenantName} submitted a reservation request for Room ${roomNumber} at ${propertyName}.`,
    relatedId: reservationId,
    relatedType: RELATED_TYPES.RESERVATION,
  });
}

// 2. Owner approved a reservation → the applying tenant.
async function notifyReservationApproved(executor, { tenantId, roomNumber, propertyName, reservationId }) {
  return createNotification(executor, {
    recipientId: tenantId,
    type: NOTIFICATION_TYPES.RESERVATION_APPROVED,
    title: "Reservation Approved",
    message: `Your reservation for Room ${roomNumber} at ${propertyName} has been approved.`,
    relatedId: reservationId,
    relatedType: RELATED_TYPES.RESERVATION,
  });
}

// 3. Owner rejected a reservation → the applying tenant.
async function notifyReservationRejected(executor, { tenantId, roomNumber, propertyName, reservationId, reason }) {
  const suffix = reason ? ` Reason: ${truncate(reason, 140)}` : "";
  return createNotification(executor, {
    recipientId: tenantId,
    type: NOTIFICATION_TYPES.RESERVATION_REJECTED,
    title: "Reservation Rejected",
    message: `Your reservation for Room ${roomNumber} at ${propertyName} was rejected.${suffix}`,
    relatedId: reservationId,
    relatedType: RELATED_TYPES.RESERVATION,
  });
}

// 3b. Owner directly assigned a tenant to a room (POST /api/owner/leases).
async function notifyLeaseAssigned(executor, { tenantId, roomNumber, propertyName, leaseId }) {
  return createNotification(executor, {
    recipientId: tenantId,
    type: NOTIFICATION_TYPES.RESERVATION_APPROVED,
    title: "Reservation Approved",
    message: `Your reservation for Room ${roomNumber} at ${propertyName} has been approved.`,
    relatedId: leaseId,
    relatedType: RELATED_TYPES.RESERVATION,
  });
}

// 4. Tenant submitted a payment → the owner of the property.
async function notifyPaymentSubmitted(executor, { ownerId, tenantName, amount, roomNumber, propertyName, paymentId }) {
  return createNotification(executor, {
    recipientId: ownerId,
    type: NOTIFICATION_TYPES.PAYMENT_SUBMITTED,
    title: "New Payment Submitted",
    message: `${tenantName} submitted a payment of ${formatAmount(amount)} for Room ${roomNumber} at ${propertyName}.`,
    relatedId: paymentId,
    relatedType: RELATED_TYPES.PAYMENT,
  });
}

// 5. Owner verified a payment → the tenant.
async function notifyPaymentVerified(executor, { tenantId, amount, roomNumber, propertyName, paymentId }) {
  return createNotification(executor, {
    recipientId: tenantId,
    type: NOTIFICATION_TYPES.PAYMENT_VERIFIED,
    title: "Payment Verified",
    message: `Your payment of ${formatAmount(amount)} for Room ${roomNumber} at ${propertyName} has been approved.`,
    relatedId: paymentId,
    relatedType: RELATED_TYPES.PAYMENT,
  });
}

// 6. Owner rejected a payment → the tenant.
async function notifyPaymentRejected(executor, { tenantId, amount, roomNumber, propertyName, paymentId, reason }) {
  const suffix = reason ? ` Reason: ${truncate(reason, 140)}` : "";
  return createNotification(executor, {
    recipientId: tenantId,
    type: NOTIFICATION_TYPES.PAYMENT_REJECTED,
    title: "Payment Rejected",
    message: `Your payment of ${formatAmount(amount)} for Room ${roomNumber} at ${propertyName} was rejected.${suffix}`,
    relatedId: paymentId,
    relatedType: RELATED_TYPES.PAYMENT,
  });
}

// 7. Tenant filed a maintenance request → the owner of the property.
async function notifyMaintenanceCreated(executor, { ownerId, tenantName, title, roomNumber, propertyName, maintenanceId }) {
  return createNotification(executor, {
    recipientId: ownerId,
    type: NOTIFICATION_TYPES.MAINTENANCE_CREATED,
    title: "New Maintenance Request",
    message: `${tenantName} reported “${truncate(title, 80)}” in Room ${roomNumber} at ${propertyName}.`,
    relatedId: maintenanceId,
    relatedType: RELATED_TYPES.MAINTENANCE,
  });
}

// 8. Owner moved a maintenance request to a new status → the tenant.
async function notifyMaintenanceUpdated(executor, { tenantId, title, status, maintenanceId }) {
  const label = MAINTENANCE_STATUS_LABELS[status] || status;
  return createNotification(executor, {
    recipientId: tenantId,
    type: NOTIFICATION_TYPES.MAINTENANCE_UPDATED,
    title: "Maintenance Update",
    message: `Your request “${truncate(title, 80)}” is now ${label}.`,
    relatedId: maintenanceId,
    relatedType: RELATED_TYPES.MAINTENANCE,
  });
}

// 9. Someone sent a message → the receiver.
// Note the deliberate naming: `recipientId` is the person being notified (the
// receiver of the message) and `senderName` is only used to build the title.
// Keeping these distinct prevents the classic bug of notifying the sender.
async function notifyMessageReceived(executor, { recipientId, senderName, messageId, content }) {
  return createNotification(executor, {
    recipientId,
    type: NOTIFICATION_TYPES.MESSAGE_RECEIVED,
    title: `New Message from ${senderName}`,
    message: truncate(content, 140),
    relatedId: messageId,
    relatedType: RELATED_TYPES.MESSAGE,
  });
}

// 10. Owner published an announcement → the tenants living at that property.
async function notifyAnnouncementPublished(executor, { announcementId, title, propertyId, propertyName }) {
  const tenantIds = await listPropertyTenantIds(executor, propertyId);
  return createNotifications(
    executor,
    tenantIds.map((tenantId) => ({
      recipientId: tenantId,
      type: NOTIFICATION_TYPES.ANNOUNCEMENT_PUBLISHED,
      title: "New Announcement",
      message: `${propertyName}: ${truncate(title, 120)}`,
      relatedId: announcementId,
      relatedType: RELATED_TYPES.ANNOUNCEMENT,
    }))
  );
}

// 11. A dorm owner registered → every active admin.
async function notifyAdminsOfOwnerRegistration(executor, { ownerId, ownerName, ownerEmail }) {
  const adminIds = await listAdminIds(executor);
  return createNotifications(
    executor,
    adminIds.map((adminId) => ({
      recipientId: adminId,
      type: NOTIFICATION_TYPES.OWNER_REGISTERED,
      title: "New Owner Registration",
      message: `${ownerName} (${ownerEmail}) submitted a dorm owner registration for approval.`,
      relatedId: ownerId,
      relatedType: RELATED_TYPES.OWNER,
    }))
  );
}

// 12. Admin approved an owner → the owner.
async function notifyOwnerApproved(executor, { ownerId, ownerName }) {
  return createNotification(executor, {
    recipientId: ownerId,
    type: NOTIFICATION_TYPES.OWNER_APPROVED,
    title: "Owner Account Approved",
    message: `Welcome aboard, ${ownerName}. Your dorm owner account is approved and you can now sign in to manage your properties.`,
    relatedId: ownerId,
    relatedType: RELATED_TYPES.OWNER,
  });
}

// 13. Admin rejected an owner → the owner.
async function notifyOwnerRejected(executor, { ownerId, ownerName }) {
  return createNotification(executor, {
    recipientId: ownerId,
    type: NOTIFICATION_TYPES.OWNER_REJECTED,
    title: "Owner Registration Rejected",
    message: `${ownerName}, your dorm owner registration was rejected. Please contact the administrator.`,
    relatedId: ownerId,
    relatedType: RELATED_TYPES.OWNER,
  });
}

// 14. Someone submitted a star rating → the person who was rated.
// related_id is the rater so the recipient can open that person's existing screen.
async function notifyRatingReceived(executor, { rateeId, raterId, raterName, stars }) {
  const starLabel = `${stars} star${stars === 1 ? "" : "s"}`;
  return createNotification(executor, {
    recipientId: rateeId,
    type: NOTIFICATION_TYPES.RATING_RECEIVED,
    title: "New Rating",
    message: `${raterName} rated you ${starLabel}.`,
    relatedId: raterId,
    relatedType: RELATED_TYPES.RATING,
  });
}

module.exports = {
  NOTIFICATION_TYPES,
  RELATED_TYPES,
  createNotification,
  createNotifications,
  listAdminIds,
  listPropertyTenantIds,
  notifyReservationRequested,
  notifyReservationApproved,
  notifyReservationRejected,
  notifyLeaseAssigned,
  notifyPaymentSubmitted,
  notifyPaymentVerified,
  notifyPaymentRejected,
  notifyMaintenanceCreated,
  notifyMaintenanceUpdated,
  notifyMessageReceived,
  notifyAnnouncementPublished,
  notifyAdminsOfOwnerRegistration,
  notifyOwnerApproved,
  notifyOwnerRejected,
  notifyRatingReceived,
};
