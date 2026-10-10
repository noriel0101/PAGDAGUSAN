const express = require("express");
const pool = require("../db");
const requireAuth = require("../middleware/auth");
const requireRole = require("../middleware/role");
const {
  notifyReservationRequested,
  notifyPaymentSubmitted,
  notifyMaintenanceCreated,
} = require("../services/notifications");
const { toPublicPhotoUrl } = require("../lib/photoUrl");
const { MATCH_THRESHOLD, scoreCompatibility } = require("../lib/compatibility");

const router = express.Router();

router.use(requireAuth);
router.use(requireRole("tenant"));

const PAYMENT_METHODS = ["cash", "gcash", "bank_transfer", "maya", "other"];
const MAINTENANCE_PRIORITIES = ["low", "medium", "high", "urgent"];
const MAINTENANCE_CATEGORIES = [
  "plumbing", "electrical", "appliance", "furniture", "structure",
  "internet", "pest_control", "cleaning", "security", "general", "other",
];
// A tenant may cancel while the request is still being triaged (not yet work-in-progress or closed).
const TENANT_CANCELLABLE_STATUSES = ["pending", "reviewing"];

// Returns { propertyId, ownerId } of the tenant's current (active) lease, or null.
async function tenantPropertyContext(uid) {
  const result = await pool.query(
    `SELECT v.property_id, p.owner_id FROM tenant_current_room v
     JOIN properties p ON p.id = v.property_id
     WHERE v.tenant_id = $1
     LIMIT 1`,
    [uid]
  );
  return result.rows.length ? result.rows[0] : null;
}

// ─── Dashboard ─────────────────────────────────────────
// Returns the tenant's current room/property (via active lease),
// lease info, payment summary, latest payment, announcements,
// and maintenance (open count).
router.get("/dashboard", async (req, res) => {
  try {
    const uid = req.user.userId;

    const roomResult = await pool.query(
      `SELECT v.tenant_id, v.lease_id, v.room_id, v.room_number, v.floor, v.monthly_rent,
              v.property_id, v.property_name, v.address
       FROM tenant_current_room v
       WHERE v.tenant_id = $1
       LIMIT 1`,
      [uid]
    );

    const room = roomResult.rows[0];

    const reservationSummaryResult = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'pending_approval')::int AS pending,
         COUNT(*) FILTER (WHERE status = 'active')::int AS active,
         COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected
       FROM leases
       WHERE tenant_id = $1`,
      [uid]
    );

    const reservationSummary = {
      total: reservationSummaryResult.rows[0].total,
      pending: reservationSummaryResult.rows[0].pending,
      active: reservationSummaryResult.rows[0].active,
      rejected: reservationSummaryResult.rows[0].rejected,
    };

    if (!room) {
      return res.json({
        success: true,
        data: {
          hasRoom: false,
          room: null,
          lease: null,
          reservationSummary,
          paymentSummary: {
            pendingAmount: 0,
            pendingCount: 0,
            paidAmount: 0,
            paidCount: 0,
          },
          latestPayment: null,
          announcements: [],
          maintenance: [],
          openMaintenanceCount: 0,
        },
      });
    }

    const leaseResult = await pool.query(
      `SELECT l.id, l.status, l.start_date, l.end_date, l.monthly_rent,
              l.security_deposit, l.requested_at
       FROM leases l
       WHERE l.id = $1`,
      [room.lease_id]
    );

    const lease = leaseResult.rows[0];

    const payResult = await pool.query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0)::numeric AS pending_amount,
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count,
         COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0)::numeric AS paid_amount,
         COUNT(*) FILTER (WHERE status = 'paid')::int AS paid_count
       FROM payments
       WHERE tenant_id = $1`,
      [uid]
    );

    const pay = payResult.rows[0];

    const latestPayResult = await pool.query(
      `SELECT id, amount, status, payment_method, created_at
       FROM payments
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [uid]
    );
    const latestPay = latestPayResult.rows[0];

    const annResult = await pool.query(
      `SELECT a.id, a.title, a.content, a.published_at, a.created_at
       FROM announcements a
       JOIN properties p ON p.id = a.property_id
       JOIN tenant_current_room v ON v.property_id = p.id
       WHERE v.tenant_id = $1 AND a.status = 'published'
       ORDER BY a.published_at DESC
       LIMIT 5`,
      [uid]
    );

    const maintResult = await pool.query(
      `SELECT m.id, m.title, m.description, m.priority, m.status, m.created_at, m.updated_at,
              m.owner_notes
       FROM maintenance_requests m
       WHERE m.tenant_id = $1
       ORDER BY m.created_at DESC
       LIMIT 5`,
      [uid]
    );

    const openCountResult = await pool.query(
      `SELECT COUNT(*)::int AS open_count
       FROM maintenance_requests
       WHERE tenant_id = $1 AND status IN ('pending', 'reviewing', 'in_progress')`,
      [uid]
    );

    return res.json({
      success: true,
      data: {
        hasRoom: true,
        reservationSummary,
        room: {
          leaseId: room.lease_id,
          roomId: room.room_id,
          roomNumber: room.room_number,
          floor: room.floor,
          monthlyRent: room.monthly_rent,
          propertyId: room.property_id,
          propertyName: room.property_name,
          address: room.address,
        },
        lease: lease
          ? {
              id: lease.id,
              status: lease.status,
              startDate: lease.start_date,
              endDate: lease.end_date,
              monthlyRent: lease.monthly_rent,
              securityDeposit: lease.security_deposit,
              requestedAt: lease.requested_at,
            }
          : null,
        paymentSummary: {
          pendingAmount: pay.pending_amount,
          pendingCount: pay.pending_count,
          paidAmount: pay.paid_amount,
          paidCount: pay.paid_count,
        },
        latestPayment: latestPay
          ? {
              id: latestPay.id,
              amount: latestPay.amount,
              status: latestPay.status,
              paymentMethod: latestPay.payment_method,
              createdAt: latestPay.created_at,
            }
          : null,
        announcements: annResult.rows.map((a) => ({
          id: a.id,
          title: a.title,
          content: a.content,
          publishedAt: a.published_at,
          createdAt: a.created_at,
        })),
        maintenance: maintResult.rows.map((m) => ({
          id: m.id,
          title: m.title,
          description: m.description,
          priority: m.priority,
          status: m.status,
          createdAt: m.created_at,
          updatedAt: m.updated_at,
          ownerNotes: m.owner_notes,
        })),
        openMaintenanceCount: openCountResult.rows[0].open_count,
      },
    });
  } catch (error) {
    console.error("Get tenant dashboard error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── Profile ───────────────────────────────────────────
router.get("/profile", async (req, res) => {
  try {
    const uid = req.user.userId;

    const result = await pool.query(
      `SELECT id, name, email, phone, role, status, email_verified, created_at
       FROM users
       WHERE id = $1`,
      [uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Account not found" });
    }

    const u = result.rows[0];
    return res.json({
      success: true,
      data: {
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        role: u.role,
        accountStatus: u.status,
        emailVerified: u.email_verified,
        createdAt: u.created_at,
      },
    });
  } catch (error) {
    console.error("Get tenant profile error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.put("/profile", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { name, email, phone } = req.body;

    if (!name || !email) {
      return res.status(400).json({ success: false, message: "Name and email are required" });
    }

    const existing = await pool.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2`,
      [email, uid]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, message: "An account with this email already exists" });
    }

    const result = await pool.query(
      `UPDATE users
       SET name = $1, email = $2, phone = $3, updated_at = NOW()
       WHERE id = $4 AND role = 'tenant'
       RETURNING id, name, email, phone, role, status`,
      [name, email, phone || null, uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Account not found" });
    }

    const u = result.rows[0];
    return res.json({
      success: true,
      message: "Profile updated",
      data: {
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        role: u.role,
        accountStatus: u.status,
      },
    });
  } catch (error) {
    console.error("Update tenant profile error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── Current lease ─────────────────────────────────────
// The tenant can only ever see their own (active) lease.
router.get("/lease", async (req, res) => {
  try {
    const uid = req.user.userId;

    const result = await pool.query(
      `SELECT l.id, l.tenant_id, l.status, l.start_date, l.end_date, l.monthly_rent,
              l.security_deposit, l.requested_at, l.notes,
              r.id AS room_id, r.room_number, r.floor, r.capacity, r.current_occupancy,
              r.amenities, r.description AS room_description,
              p.id AS property_id, p.name AS property_name, p.address,
              p.contact_number AS property_contact
       FROM leases l
       JOIN rooms r ON r.id = l.room_id
       JOIN properties p ON p.id = r.property_id
       WHERE l.tenant_id = $1 AND l.status = 'active'
       ORDER BY l.created_at DESC
       LIMIT 1`,
      [uid]
    );

    if (result.rows.length === 0) {
      return res.json({ success: true, data: null });
    }

    const l = result.rows[0];
    return res.json({
      success: true,
      data: {
        id: l.id,
        status: l.status,
        startDate: l.start_date,
        endDate: l.end_date,
        monthlyRent: l.monthly_rent,
        securityDeposit: l.security_deposit,
        requestedAt: l.requested_at,
        notes: l.notes,
        roomId: l.room_id,
        roomNumber: l.room_number,
        floor: l.floor,
        capacity: l.capacity,
        currentOccupancy: l.current_occupancy,
        amenities: l.amenities || [],
        roomDescription: l.room_description,
        propertyId: l.property_id,
        propertyName: l.property_name,
        propertyAddress: l.address,
        propertyContact: l.property_contact,
      },
    });
  } catch (error) {
    console.error("Get tenant lease error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── Current room ──────────────────────────────────────
router.get("/room", async (req, res) => {
  try {
    const uid = req.user.userId;

    const result = await pool.query(
      `SELECT l.id AS lease_id, l.status AS lease_status, l.start_date, l.end_date,
              l.security_deposit,
              r.id AS room_id, r.room_number, r.floor, r.monthly_rent, r.capacity,
              r.current_occupancy, r.amenities, r.description, r.status AS room_status,
              p.id AS property_id, p.name AS property_name, p.address, p.contact_number,
              p.latitude, p.longitude,
              u.id AS owner_id, u.name AS owner_name
       FROM leases l
       JOIN rooms r ON r.id = l.room_id
       JOIN properties p ON p.id = r.property_id
       JOIN users u ON u.id = p.owner_id
       WHERE l.tenant_id = $1 AND l.status = 'active'
       ORDER BY l.created_at DESC
       LIMIT 1`,
      [uid]
    );

    if (result.rows.length === 0) {
      return res.json({ success: true, data: null });
    }

    const r = result.rows[0];

    return res.json({
      success: true,
      data: {
        leaseId: r.lease_id,
        leaseStatus: r.lease_status,
        startDate: r.start_date,
        endDate: r.end_date,
        securityDeposit: r.security_deposit,
        roomId: r.room_id,
        roomNumber: r.room_number,
        floor: r.floor,
        monthlyRent: r.monthly_rent,
        capacity: r.capacity,
        currentOccupancy: r.current_occupancy,
        amenities: r.amenities || [],
        roomDescription: r.description,
        roomStatus: r.room_status,
        propertyId: r.property_id,
        propertyName: r.property_name,
        address: r.address,
        contactNumber: r.contact_number,
        latitude: r.latitude != null ? Number(r.latitude) : null,
        longitude: r.longitude != null ? Number(r.longitude) : null,
        ownerId: r.owner_id,
        ownerName: r.owner_name,
      },
    });
  } catch (error) {
    console.error("Get tenant room error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── Payments ──────────────────────────────────────────
router.get("/payments", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { status } = req.query;

    let query = `
      SELECT p.id, p.amount, p.status, p.payment_date, p.payment_method,
             p.reference_number, p.receipt_url, p.proof_url, p.rejection_reason,
             p.billing_period_start, p.billing_period_end, p.created_at,
             p.verified_by, p.verified_at, p.notes,
             l.id AS lease_id,
             r.id AS room_id, r.room_number,
             prop.id AS property_id, prop.name AS property_name,
             owner.id AS owner_id, owner.name AS owner_name
      FROM payments p
      JOIN leases l ON p.lease_id = l.id
      JOIN rooms r ON l.room_id = r.id
      JOIN properties prop ON r.property_id = prop.id
      JOIN users owner ON owner.id = prop.owner_id
      WHERE p.tenant_id = $1
    `;
    const params = [uid];
    let idx = 2;

    if (status && status !== "all") {
      query += ` AND p.status = $${idx}`;
      params.push(status);
      idx++;
    }

    query += ` ORDER BY p.created_at DESC`;

    const result = await pool.query(query, params);

    return res.json({
      success: true,
      data: result.rows.map((r) => ({
        id: r.id,
        amount: r.amount,
        status: r.status,
        paymentDate: r.payment_date,
        paymentMethod: r.payment_method,
        referenceNumber: r.reference_number,
        receiptUrl: r.receipt_url,
        proofUrl: r.proof_url,
        rejectionReason: r.rejection_reason,
        billingPeriodStart: r.billing_period_start,
        billingPeriodEnd: r.billing_period_end,
        createdAt: r.created_at,
        verifiedBy: r.verified_by,
        verifiedAt: r.verified_at,
        notes: r.notes,
        leaseId: r.lease_id,
        roomId: r.room_id,
        roomNumber: r.room_number,
        propertyId: r.property_id,
        propertyName: r.property_name,
        ownerId: r.owner_id,
        ownerName: r.owner_name,
      })),
    });
  } catch (error) {
    console.error("Get tenant payments error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/payments/:id", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      `SELECT p.id, p.amount, p.status, p.payment_date, p.payment_method,
              p.reference_number, p.receipt_url, p.proof_url, p.rejection_reason,
              p.billing_period_start, p.billing_period_end, p.created_at,
              p.verified_by, p.verified_at, p.notes,
              l.id AS lease_id,
              r.id AS room_id, r.room_number,
              prop.id AS property_id, prop.name AS property_name,
              owner.id AS owner_id, owner.name AS owner_name,
              pb.name AS verified_by_name
       FROM payments p
       JOIN leases l ON p.lease_id = l.id
       JOIN rooms r ON l.room_id = r.id
       JOIN properties prop ON r.property_id = prop.id
       JOIN users owner ON owner.id = prop.owner_id
       LEFT JOIN users pb ON pb.id = p.verified_by
       WHERE p.id = $1 AND p.tenant_id = $2`,
      [id, uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Payment not found" });
    }

    const p = result.rows[0];
    return res.json({
      success: true,
      data: {
        id: p.id,
        amount: p.amount,
        status: p.status,
        paymentDate: p.payment_date,
        paymentMethod: p.payment_method,
        referenceNumber: p.reference_number,
        receiptUrl: p.receipt_url,
        proofUrl: p.proof_url,
        rejectionReason: p.rejection_reason,
        billingPeriodStart: p.billing_period_start,
        billingPeriodEnd: p.billing_period_end,
        createdAt: p.created_at,
        verifiedBy: p.verified_by,
        verifiedAt: p.verified_at,
        verifiedByName: p.verified_by_name,
        notes: p.notes,
        leaseId: p.lease_id,
        roomId: p.room_id,
        roomNumber: p.room_number,
        propertyId: p.property_id,
        propertyName: p.property_name,
        ownerId: p.owner_id,
        ownerName: p.owner_name,
      },
    });
  } catch (error) {
    console.error("Get tenant payment error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post("/payments", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { amount, paymentMethod, referenceNumber, paymentDate, proofUrl, billingPeriodStart, billingPeriodEnd, notes } = req.body;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: "A valid amount is required" });
    }
    if (!paymentMethod || !PAYMENT_METHODS.includes(paymentMethod)) {
      return res.status(400).json({ success: false, message: "Invalid payment method" });
    }
    if (paymentDate !== undefined && paymentDate !== null && paymentDate !== "") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(paymentDate))) {
        return res.status(400).json({ success: false, message: "Payment date must use the format YYYY-MM-DD" });
      }
    }
    if (billingPeriodStart !== undefined && billingPeriodStart !== null && billingPeriodStart !== "") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(billingPeriodStart))) {
        return res.status(400).json({ success: false, message: "Billing period start must use the format YYYY-MM-DD" });
      }
    }
    if (billingPeriodEnd !== undefined && billingPeriodEnd !== null && billingPeriodEnd !== "") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(billingPeriodEnd))) {
        return res.status(400).json({ success: false, message: "Billing period end must use the format YYYY-MM-DD" });
      }
    }

    // The tenant id ALWAYS comes from req.user.userId. The lease is looked up
    // from the tenant's own active lease only, so a payment can never be
    // attached to another tenant's lease or another owner's property.
    const roomResult = await pool.query(
      `SELECT v.lease_id, v.room_id, v.property_id, v.room_number, v.property_name, p.owner_id
       FROM tenant_current_room v
       JOIN properties p ON p.id = v.property_id
       WHERE v.tenant_id = $1
       LIMIT 1`,
      [uid]
    );
    if (roomResult.rows.length === 0) {
      return res.status(409).json({ success: false, message: "You are not assigned to an active lease yet" });
    }
    const leaseId = roomResult.rows[0].lease_id;

    // The payment row and the owner's notification are committed together.
    const client = await pool.connect();
    let p;
    try {
      await client.query("BEGIN");

      const result = await client.query(
        `INSERT INTO payments (lease_id, tenant_id, amount, payment_method, reference_number, payment_date, proof_url, billing_period_start, billing_period_end, notes)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, CURRENT_DATE), $7, $8, $9, $10)
         RETURNING id, lease_id, tenant_id, amount, payment_method, reference_number, payment_date, proof_url, status, billing_period_start, billing_period_end, notes, created_at`,
        [
          leaseId,
          uid,
          amount,
          paymentMethod,
          referenceNumber || null,
          paymentDate || null,
          proofUrl || null,
          billingPeriodStart || null,
          billingPeriodEnd || null,
          notes || null,
        ]
      );

      p = result.rows[0];

      const tenantResult = await client.query(`SELECT name FROM users WHERE id = $1`, [uid]);
      await notifyPaymentSubmitted(client, {
        ownerId: roomResult.rows[0].owner_id,
        tenantName: tenantResult.rows[0]?.name || "A tenant",
        amount: p.amount,
        roomNumber: roomResult.rows[0].room_number,
        propertyName: roomResult.rows[0].property_name,
        paymentId: p.id,
      });

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    const payment = {
      id: p.id,
      leaseId: p.lease_id,
      tenantId: p.tenant_id,
      amount: p.amount,
      paymentMethod: p.payment_method,
      referenceNumber: p.reference_number,
      paymentDate: p.payment_date,
      proofUrl: p.proof_url,
      status: p.status,
      billingPeriodStart: p.billing_period_start,
      billingPeriodEnd: p.billing_period_end,
      notes: p.notes,
      createdAt: p.created_at,
      roomNumber: roomResult.rows[0].room_number,
      propertyId: roomResult.rows[0].property_id,
      propertyName: roomResult.rows[0].property_name,
      ownerId: roomResult.rows[0].owner_id,
    };
    return res.status(201).json({
      success: true,
      message: "Payment submitted successfully",
      payment,
      data: payment,
    });
  } catch (error) {
    console.error("Create tenant payment error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── Maintenance ───────────────────────────────────────
router.get("/maintenance", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { status } = req.query;

    let query = `
      SELECT m.id, m.title, m.description, m.category, m.priority, m.status, m.created_at, m.updated_at,
             m.owner_notes, m.image_url, m.completed_at,
             r.id AS room_id, r.room_number,
             prop.id AS property_id, prop.name AS property_name
       FROM maintenance_requests m
       JOIN rooms r ON m.room_id = r.id
       JOIN properties prop ON r.property_id = prop.id
       WHERE m.tenant_id = $1
    `;
    const params = [uid];
    if (status && status !== "all") {
      params.push(status);
      query += ` AND m.status = $${params.length}`;
    }
    query += ` ORDER BY m.created_at DESC`;

    const result = await pool.query(query, params);

    return res.json({
      success: true,
      data: result.rows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        category: r.category,
        priority: r.priority,
        status: r.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        ownerNotes: r.owner_notes,
        imageUrl: r.image_url,
        completedAt: r.completed_at,
        roomId: r.room_id,
        roomNumber: r.room_number,
        propertyId: r.property_id,
        propertyName: r.property_name,
      })),
    });
  } catch (error) {
    console.error("Get tenant maintenance error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/maintenance/:id", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      `SELECT m.id, m.title, m.description, m.category, m.priority, m.status, m.created_at, m.updated_at,
              m.owner_notes, m.image_url, m.completed_at,
              r.id AS room_id, r.room_number, r.floor,
              prop.id AS property_id, prop.name AS property_name
       FROM maintenance_requests m
       JOIN rooms r ON m.room_id = r.id
       JOIN properties prop ON r.property_id = prop.id
       WHERE m.id = $1 AND m.tenant_id = $2`,
      [id, uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }

    const m = result.rows[0];
    return res.json({
      success: true,
      data: {
        id: m.id,
        title: m.title,
        description: m.description,
        category: m.category,
        priority: m.priority,
        status: m.status,
        createdAt: m.created_at,
        updatedAt: m.updated_at,
        ownerNotes: m.owner_notes,
        imageUrl: m.image_url,
        completedAt: m.completed_at,
        roomId: m.room_id,
        roomNumber: m.room_number,
        floor: m.floor,
        propertyId: m.property_id,
        propertyName: m.property_name,
      },
    });
  } catch (error) {
    console.error("Get tenant maintenance detail error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post("/maintenance", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { title, description, category, priority, imageUrl } = req.body;

    if (!title || !description) {
      return res.status(400).json({ success: false, message: "Title and description are required" });
    }
    if (category && !MAINTENANCE_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: "Invalid category" });
    }
    if (priority && !MAINTENANCE_PRIORITIES.includes(priority)) {
      return res.status(400).json({ success: false, message: "Invalid priority" });
    }
    if (imageUrl && !/^https?:\/\/.+/i.test(String(imageUrl))) {
      return res.status(400).json({ success: false, message: "Image URL must be a valid http(s) URL" });
    }

    // The tenant id and room always come from the caller's own active lease;
    // a request can never be attached to another tenant's room/property.
    const roomResult = await pool.query(
      `SELECT v.room_id, v.room_number, v.property_id, v.property_name, p.owner_id
       FROM tenant_current_room v
       JOIN properties p ON p.id = v.property_id
       WHERE v.tenant_id = $1
       LIMIT 1`,
      [uid]
    );
    if (roomResult.rows.length === 0) {
      return res.status(409).json({ success: false, message: "You are not assigned to an active lease yet" });
    }
    const room = roomResult.rows[0];

    // The ticket and the owner's notification are committed together.
    const client = await pool.connect();
    let m;
    try {
      await client.query("BEGIN");

      const result = await client.query(
        `INSERT INTO maintenance_requests (tenant_id, room_id, title, description, category, priority, image_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, tenant_id, room_id, title, description, category, priority, status, image_url, created_at, updated_at`,
        [uid, room.room_id, title, description, category || "general", priority || "medium", imageUrl || null]
      );

      m = result.rows[0];

      const tenantResult = await client.query(`SELECT name FROM users WHERE id = $1`, [uid]);
      await notifyMaintenanceCreated(client, {
        ownerId: room.owner_id,
        tenantName: tenantResult.rows[0]?.name || "A tenant",
        title: m.title,
        roomNumber: room.room_number,
        propertyName: room.property_name,
        maintenanceId: m.id,
      });

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    return res.status(201).json({
      success: true,
      message: "Maintenance request submitted",
      data: {
        id: m.id,
        title: m.title,
        description: m.description,
        category: m.category,
        priority: m.priority,
        status: m.status,
        imageUrl: m.image_url,
        createdAt: m.created_at,
        updatedAt: m.updated_at,
        roomId: m.room_id,
        roomNumber: room.room_number,
        propertyId: room.property_id,
        propertyName: room.property_name,
      },
    });
  } catch (error) {
    console.error("Create tenant maintenance error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Tenant updates their own request while it is still pending. room_id,
// property_id, and tenant_id are never accepted from the client.
router.patch("/maintenance/:id", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;
    const { title, description, category, priority, imageUrl } = req.body;

    if (title !== undefined && typeof title !== "string") {
      return res.status(400).json({ success: false, message: "Invalid title" });
    }
    if (description !== undefined && typeof description !== "string") {
      return res.status(400).json({ success: false, message: "Invalid description" });
    }
    if (category && !MAINTENANCE_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: "Invalid category" });
    }
    if (priority && !MAINTENANCE_PRIORITIES.includes(priority)) {
      return res.status(400).json({ success: false, message: "Invalid priority" });
    }
    if (imageUrl !== undefined && imageUrl !== null && imageUrl !== "" && !/^https?:\/\/.+/i.test(String(imageUrl))) {
      return res.status(400).json({ success: false, message: "Image URL must be a valid http(s) URL" });
    }

    const existing = await pool.query(
      `SELECT m.id, m.status FROM maintenance_requests m WHERE m.id = $1 AND m.tenant_id = $2`,
      [id, uid]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }
    if (existing.rows[0].status !== "pending") {
      return res.status(409).json({ success: false, message: "This request can no longer be edited" });
    }

    const result = await pool.query(
      `UPDATE maintenance_requests
       SET title = COALESCE($2, title),
           description = COALESCE($3, description),
           category = COALESCE($4, category),
           priority = COALESCE($5, priority),
           image_url = CASE WHEN $6::text IS NULL THEN image_url ELSE $6::text END,
           updated_at = NOW()
       WHERE id = $1 AND tenant_id = $7
       RETURNING id, title, description, category, priority, status, image_url, created_at, updated_at`,
      [
        id,
        title || null,
        description || null,
        category || null,
        priority || null,
        imageUrl === undefined ? null : imageUrl,
        uid,
      ]
    );

    const m = result.rows[0];
    return res.json({
      success: true,
      message: "Maintenance request updated",
      data: {
        id: m.id,
        title: m.title,
        description: m.description,
        category: m.category,
        priority: m.priority,
        status: m.status,
        imageUrl: m.image_url,
        updatedAt: m.updated_at,
      },
    });
  } catch (error) {
    console.error("Update tenant maintenance error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Tenant cancels their own request while it is still eligible.
router.patch("/maintenance/:id/cancel", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE maintenance_requests
       SET status = 'cancelled',
           completed_at = NULL,
           updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND status = ANY($3::maintenance_status[])
       RETURNING id, status, updated_at`,
      [id, uid, TENANT_CANCELLABLE_STATUSES]
    );

    if (result.rows.length === 0) {
      const exists = await pool.query(
        `SELECT id, status FROM maintenance_requests WHERE id = $1 AND tenant_id = $2`,
        [id, uid]
      );
      if (exists.rows.length === 0) {
        return res.status(404).json({ success: false, message: "Request not found" });
      }
      return res.status(409).json({ success: false, message: "This request can no longer be cancelled" });
    }

    return res.json({
      success: true,
      message: "Maintenance request cancelled",
      data: { id: result.rows[0].id, status: result.rows[0].status },
    });
  } catch (error) {
    console.error("Cancel tenant maintenance error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── Announcements ─────────────────────────────────────
// Only published announcements scoped to the tenant's property
// (including owner-wide announcements without a specific property).
router.get("/announcements", async (req, res) => {
  try {
    const uid = req.user.userId;

    const context = await tenantPropertyContext(uid);
    if (!context) {
      return res.json({ success: true, data: [] });
    }

    const result = await pool.query(
      `SELECT a.id, a.title, a.content, a.published_at, a.created_at, a.updated_at,
              a.status,
              p.name AS property_name,
              u.name AS owner_name
       FROM announcements a
       LEFT JOIN properties p ON p.id = a.property_id
       LEFT JOIN users u ON u.id = a.owner_id
       WHERE a.status = 'published'
         AND (a.property_id = $1 OR (a.property_id IS NULL AND a.owner_id = $2))
       ORDER BY a.published_at DESC`,
      [context.property_id, context.owner_id]
    );

    return res.json({
      success: true,
      data: result.rows.map((r) => ({
        id: r.id,
        title: r.title,
        content: r.content,
        status: r.status,
        publishedAt: r.published_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        propertyName: r.property_name,
        ownerName: r.owner_name,
      })),
    });
  } catch (error) {
    console.error("Get tenant announcements error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/announcements/:id", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;

    const context = await tenantPropertyContext(uid);
    if (!context) {
      return res.status(404).json({ success: false, message: "Announcement not found" });
    }

    const result = await pool.query(
      `SELECT a.id, a.title, a.content, a.published_at, a.created_at, a.updated_at,
              a.status,
              p.name AS property_name,
              u.name AS owner_name
       FROM announcements a
       LEFT JOIN properties p ON p.id = a.property_id
       LEFT JOIN users u ON u.id = a.owner_id
       WHERE a.id = $1 AND a.status = 'published'
         AND (a.property_id = $2 OR (a.property_id IS NULL AND a.owner_id = $3))`,
      [id, context.property_id, context.owner_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Announcement not found" });
    }

    const a = result.rows[0];
    return res.json({
      success: true,
      data: {
        id: a.id,
        title: a.title,
        content: a.content,
        status: a.status,
        publishedAt: a.published_at,
        createdAt: a.created_at,
        updatedAt: a.updated_at,
        propertyName: a.property_name,
        ownerName: a.owner_name,
      },
    });
  } catch (error) {
    console.error("Get tenant announcement detail error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── Messages ──────────────────────────────────────────
// Messaging lives under /api/messages (backend/routes/messages.js) so owners
// and tenants share one secure, relationship-checked implementation.

// ─── Roommate matching ─────────────────────────────────
// A shared-room reservation can carry roommate preferences.
// Scoring compares the viewer's profile with the other tenant's profile.
// The response uses a first name, a score, and match-profile labels.
// It does not include contact details, last name, or budget.

const LIFESTYLE_COLUMNS = `
  is_non_smoker, is_non_drinker, budget_max, room_share, sleep_schedule,
  cleanliness, noise_tolerance, study_habit, social_preference, pet_preference, interests
`;

const CHOICES = {
  roomShare: new Set(["private", "either", "shared"]),
  sleepSchedule: new Set(["early", "flexible", "late"]),
  noiseTolerance: new Set(["quiet", "moderate", "lively"]),
  studyHabit: new Set(["alone", "mixed", "group"]),
  socialPreference: new Set(["private", "balanced", "social"]),
  petPreference: new Set(["no_pets", "ok_with_pets", "has_pets"]),
};

function flag(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function mapLifestyle(row) {
  if (!row || typeof row.is_non_smoker !== "boolean") return null;
  return {
    nonSmoker: row.is_non_smoker,
    nonDrinker: row.is_non_drinker,
    budgetMax: row.budget_max != null ? Number(row.budget_max) : null,
    roomShare: row.room_share,
    sleepSchedule: row.sleep_schedule,
    cleanliness: row.cleanliness != null ? Number(row.cleanliness) : null,
    noiseTolerance: row.noise_tolerance,
    studyHabit: row.study_habit,
    socialPreference: row.social_preference,
    petPreference: row.pet_preference,
    interests: Array.isArray(row.interests) ? row.interests : [],
  };
}

function choiceOrError(value, allowed, label) {
  if (value == null || value === "") return null;
  const text = String(value).trim().toLowerCase();
  if (!allowed.has(text)) return { error: `${label} is not a valid choice` };
  return text;
}

function readLifestyleUpdate(body, current) {
  const source = body || {};
  const has = (key) => Object.prototype.hasOwnProperty.call(source, key);
  const next = {
    nonSmoker: has("nonSmoker") ? flag(source.nonSmoker) : current?.nonSmoker ?? false,
    nonDrinker: has("nonDrinker") ? flag(source.nonDrinker) : current?.nonDrinker ?? false,
    budgetMax: current?.budgetMax ?? null,
    roomShare: current?.roomShare ?? null,
    sleepSchedule: current?.sleepSchedule ?? null,
    cleanliness: current?.cleanliness ?? null,
    noiseTolerance: current?.noiseTolerance ?? null,
    studyHabit: current?.studyHabit ?? null,
    socialPreference: current?.socialPreference ?? null,
    petPreference: current?.petPreference ?? null,
    interests: current?.interests ?? [],
  };

  if (has("budgetMax")) {
    if (source.budgetMax == null || source.budgetMax === "") {
      next.budgetMax = null;
    } else {
      const amount = Number(source.budgetMax);
      if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) {
        return { error: "Budget must be a monthly amount from 0 to 1000000" };
      }
      next.budgetMax = Math.round(amount * 100) / 100;
    }
  }

  if (has("cleanliness")) {
    if (source.cleanliness == null || source.cleanliness === "") {
      next.cleanliness = null;
    } else {
      const level = Number(source.cleanliness);
      if (!Number.isInteger(level) || level < 1 || level > 5) {
        return { error: "Cleanliness must be a whole number from 1 to 5" };
      }
      next.cleanliness = level;
    }
  }

  const enums = [
    ["roomShare", "Room preference"],
    ["sleepSchedule", "Sleep schedule"],
    ["noiseTolerance", "Noise tolerance"],
    ["studyHabit", "Study habits"],
    ["socialPreference", "Social preference"],
    ["petPreference", "Pet preference"],
  ];
  for (const [key, label] of enums) {
    if (!has(key)) continue;
    const parsed = choiceOrError(source[key], CHOICES[key], label);
    if (parsed && parsed.error) return parsed;
    next[key] = parsed;
  }

  if (has("interests")) {
    if (!Array.isArray(source.interests)) return { error: "Interests must be a list" };
    const cleaned = [];
    for (const item of source.interests) {
      const text = String(item || "").trim().slice(0, 30);
      if (!text) continue;
      if (cleaned.some((existing) => existing.toLowerCase() === text.toLowerCase())) continue;
      cleaned.push(text);
      if (cleaned.length >= 8) break;
    }
    next.interests = cleaned;
  }

  return next;
}

async function viewerLifestyle(uid) {
  const result = await pool.query(
    `SELECT ${LIFESTYLE_COLUMNS} FROM tenant_lifestyles WHERE tenant_id = $1`,
    [uid]
  );
  return mapLifestyle(result.rows[0]);
}

function preferencesMatch(preferences, lifestyle) {
  if (!preferences.nonSmoker && !preferences.nonDrinker) return null;
  if (!lifestyle) return null;
  if (preferences.nonSmoker && !lifestyle.nonSmoker) return false;
  if (preferences.nonDrinker && !lifestyle.nonDrinker) return false;
  return true;
}

function smokingOrDrinkingConflict(preferences, lifestyle) {
  if (!lifestyle) return false;
  if (preferences.nonSmoker && lifestyle.nonSmoker === false) return true;
  if (preferences.nonDrinker && lifestyle.nonDrinker === false) return true;
  return false;
}

function profileForScoring(row) {
  const saved = mapLifestyle(row);
  if (saved) return saved;
  return {
    nonSmoker: row.wants_non_smoker ? true : null,
    nonDrinker: row.wants_non_drinker ? true : null,
    budgetMax: null,
    roomShare: null,
    sleepSchedule: null,
    cleanliness: null,
    noiseTolerance: null,
    studyHabit: null,
    socialPreference: null,
    petPreference: null,
    interests: [],
  };
}

const PROFILE_LABELS = {
  roomShare: { private: "Private room", either: "Either room", shared: "Shared room" },
  sleepSchedule: { early: "Early sleeper", flexible: "Flexible sleep", late: "Late sleeper" },
  noiseTolerance: { quiet: "Quiet", moderate: "Moderate noise", lively: "Lively" },
  studyHabit: { alone: "Studies alone", mixed: "Mixed study", group: "Group study" },
  socialPreference: { private: "Keeps to themselves", balanced: "Balanced socially", social: "Social" },
  petPreference: { no_pets: "No pets", ok_with_pets: "OK with pets", has_pets: "Has pets" },
};

function publicMatchProfile(row) {
  const saved = mapLifestyle(row);
  const items = [];
  const add = (key, label) => {
    if (label) items.push({ key, label });
  };
  const nonSmoker = saved ? saved.nonSmoker : !!row.wants_non_smoker;
  const nonDrinker = saved ? saved.nonDrinker : !!row.wants_non_drinker;
  if (nonSmoker) add("smoking", "Non-smoker");
  if (nonDrinker) add("drinking", "Non-drinker");
  if (!saved) return items.length ? items : null;
  add("room", PROFILE_LABELS.roomShare[saved.roomShare]);
  add("sleep", PROFILE_LABELS.sleepSchedule[saved.sleepSchedule]);
  add("cleanliness", saved.cleanliness != null ? `Cleanliness ${saved.cleanliness}/5` : null);
  add("noise", PROFILE_LABELS.noiseTolerance[saved.noiseTolerance]);
  add("study", PROFILE_LABELS.studyHabit[saved.studyHabit]);
  add("social", PROFILE_LABELS.socialPreference[saved.socialPreference]);
  add("pets", PROFILE_LABELS.petPreference[saved.petPreference]);
  if (saved.interests.length) add("interests", saved.interests.slice(0, 4).join(", "));
  return items.length ? items : null;
}

function resolveMatch(preferences, viewer, scored) {
  const legacy = preferencesMatch(preferences, viewer);
  if (!viewer) return null;
  if (smokingOrDrinkingConflict(preferences, viewer)) return false;
  if (scored.comparable) return scored.score >= MATCH_THRESHOLD && legacy !== false;
  return legacy;
}

async function roommateRequestsForProperties(propertyIds, viewerId) {
  if (!propertyIds.length) return [];
  const lifestyle = await viewerLifestyle(viewerId);
  const result = await pool.query(
    `SELECT l.id AS lease_id, l.status, r.id AS room_id, r.room_number, r.property_id,
            r.monthly_rent, r.capacity,
            split_part(u.name, ' ', 1) AS first_name,
            rp.wants_non_smoker, rp.wants_non_drinker,
            tl.is_non_smoker, tl.is_non_drinker, tl.budget_max, tl.room_share,
            tl.sleep_schedule, tl.cleanliness, tl.noise_tolerance, tl.study_habit,
            tl.social_preference, tl.pet_preference, tl.interests
     FROM roommate_preferences rp
     JOIN leases l ON l.id = rp.lease_id
     JOIN rooms r ON r.id = l.room_id
     JOIN users u ON u.id = l.tenant_id
     LEFT JOIN tenant_lifestyles tl ON tl.tenant_id = l.tenant_id
     WHERE r.property_id = ANY($1::uuid[])
       AND l.tenant_id <> $2
       AND l.status IN ('pending_approval', 'active')
       AND NOT EXISTS (
         SELECT 1
         FROM leases other
         WHERE other.tenant_id = l.tenant_id
           AND other.status = 'active'
           AND other.room_id <> l.room_id
       )
       AND r.capacity > 1
       AND r.current_occupancy < r.capacity
       AND r.status NOT IN ('maintenance', 'inactive')
     ORDER BY l.created_at DESC`,
    [propertyIds, viewerId]
  );

  return result.rows.map((row) => {
    const preferences = {
      nonSmoker: row.wants_non_smoker,
      nonDrinker: row.wants_non_drinker,
    };
    const scored = scoreCompatibility(lifestyle, profileForScoring(row), {
      rent: Number(row.monthly_rent),
      capacity: row.capacity,
    });
    return {
      leaseId: row.lease_id,
      propertyId: row.property_id,
      roomId: row.room_id,
      roomNumber: row.room_number,
      firstName: row.first_name,
      staying: row.status === "active",
      profile: publicMatchProfile(row),
      match: resolveMatch(preferences, lifestyle, scored),
      compatibility: scored.comparable
        ? {
            score: scored.score,
            label: scored.label,
            factors: scored.factors,
          }
        : null,
    };
  });
}

router.get("/lifestyle", async (req, res) => {
  try {
    const lifestyle = await viewerLifestyle(req.user.userId);
    return res.json({ success: true, data: lifestyle });
  } catch (error) {
    console.error("Get tenant lifestyle error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.put("/lifestyle", async (req, res) => {
  try {
    const current = await viewerLifestyle(req.user.userId);
    const next = readLifestyleUpdate(req.body, current);
    if (next.error) {
      return res.status(400).json({ success: false, message: next.error });
    }

    const result = await pool.query(
      `INSERT INTO tenant_lifestyles (
         tenant_id, is_non_smoker, is_non_drinker, budget_max, room_share, sleep_schedule,
         cleanliness, noise_tolerance, study_habit, social_preference, pet_preference, interests, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
       ON CONFLICT (tenant_id) DO UPDATE
         SET is_non_smoker = EXCLUDED.is_non_smoker,
             is_non_drinker = EXCLUDED.is_non_drinker,
             budget_max = EXCLUDED.budget_max,
             room_share = EXCLUDED.room_share,
             sleep_schedule = EXCLUDED.sleep_schedule,
             cleanliness = EXCLUDED.cleanliness,
             noise_tolerance = EXCLUDED.noise_tolerance,
             study_habit = EXCLUDED.study_habit,
             social_preference = EXCLUDED.social_preference,
             pet_preference = EXCLUDED.pet_preference,
             interests = EXCLUDED.interests,
             updated_at = NOW()
       RETURNING ${LIFESTYLE_COLUMNS}`,
      [
        req.user.userId,
        next.nonSmoker,
        next.nonDrinker,
        next.budgetMax,
        next.roomShare,
        next.sleepSchedule,
        next.cleanliness,
        next.noiseTolerance,
        next.studyHabit,
        next.socialPreference,
        next.petPreference,
        next.interests,
      ]
    );
    return res.json({ success: true, data: mapLifestyle(result.rows[0]) });
  } catch (error) {
    console.error("Update tenant lifestyle error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Stars count only for the dorm the rater actually stayed in.
const PROPERTY_RATING_COLUMNS = `
        COALESCE((
          SELECT COUNT(*)::int
          FROM ratings rt
          WHERE rt.ratee_id = u.id
            AND EXISTS (
              SELECT 1
              FROM leases rl
              JOIN rooms rr ON rr.id = rl.room_id
              WHERE rr.property_id = p.id
                AND rl.tenant_id = rt.rater_id
                AND rl.status::text IN ('active', 'completed', 'terminated')
            )
        ), 0)::int AS owner_rating_count,
        COALESCE((
          SELECT COUNT(*) FILTER (WHERE rt.stars = 5)::int
          FROM ratings rt
          WHERE rt.ratee_id = u.id
            AND EXISTS (
              SELECT 1
              FROM leases rl
              JOIN rooms rr ON rr.id = rl.room_id
              WHERE rr.property_id = p.id
                AND rl.tenant_id = rt.rater_id
                AND rl.status::text IN ('active', 'completed', 'terminated')
            )
        ), 0)::int AS owner_five_star_count,
        COALESCE((
          SELECT ROUND(AVG(rt.stars)::numeric, 1)
          FROM ratings rt
          WHERE rt.ratee_id = u.id
            AND EXISTS (
              SELECT 1
              FROM leases rl
              JOIN rooms rr ON rr.id = rl.room_id
              WHERE rr.property_id = p.id
                AND rl.tenant_id = rt.rater_id
                AND rl.status::text IN ('active', 'completed', 'terminated')
            )
        ), 0)::numeric AS owner_average_stars`;

// ─── Browse dorms (public catalog for tenants) ───────
// Lists active dorms owned by approved (active) owners,
// with count of available rooms and minimum available rent.
router.get("/browse/dorms", async (req, res) => {
  try {
    const { search, sort } = req.query;

    let query = `
      SELECT
        p.id,
        p.name,
        p.address,
        p.description,
        p.contact_number,
        p.latitude,
        p.longitude,
        p.created_at,
        (SELECT pp.photo_url FROM property_photos pp
         WHERE pp.property_id = p.id
         ORDER BY pp.is_primary DESC, pp.created_at ASC
         LIMIT 1) AS primary_photo_url,
        COALESCE((SELECT json_agg(json_build_object(
          'id', pp.id,
          'photo_url', pp.photo_url,
          'is_primary', pp.is_primary
        ) ORDER BY pp.is_primary DESC, pp.created_at ASC)
        FROM property_photos pp WHERE pp.property_id = p.id), '[]'::json) AS photos,
        u.id AS owner_id,
        u.name AS owner_name,
        u.phone AS owner_phone,
        COALESCE(COUNT(r.id) FILTER (
          WHERE r.status NOT IN ('maintenance', 'inactive') AND r.current_occupancy < r.capacity
        ), 0)::int AS available_rooms,
        COALESCE(MIN(r.monthly_rent) FILTER (
          WHERE r.status NOT IN ('maintenance', 'inactive') AND r.current_occupancy < r.capacity
        ), 0)::numeric AS min_rent,
        ${PROPERTY_RATING_COLUMNS}
      FROM properties p
      JOIN users u ON u.id = p.owner_id AND u.role = 'owner' AND u.status = 'active'
      LEFT JOIN rooms r ON r.property_id = p.id
      WHERE p.status = 'active'
    `;
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (LOWER(p.name) LIKE LOWER($${params.length}) OR LOWER(p.address) LIKE LOWER($${params.length}) OR LOWER(p.description) LIKE LOWER($${params.length}))`;
    }

    query += ` GROUP BY p.id, u.id, u.name, u.phone
               ORDER BY owner_five_star_count DESC, owner_average_stars DESC, p.created_at DESC`;

    const result = await pool.query(query, params);
    const maxFiveStars = result.rows.reduce(
      (max, row) => Math.max(max, Number(row.owner_five_star_count || 0)),
      0
    );
    const roommateRequests = await roommateRequestsForProperties(
      result.rows.map((row) => row.id),
      req.user.userId
    );
    const roommateByProperty = new Map();
    for (const request of roommateRequests) {
      const bucket = roommateByProperty.get(request.propertyId) || { requests: 0, matches: 0 };
      bucket.requests += 1;
      if (request.match === true) bucket.matches += 1;
      roommateByProperty.set(request.propertyId, bucket);
    }

    return res.json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        address: row.address,
        description: row.description,
        contactNumber: row.contact_number,
        latitude: row.latitude != null ? Number(row.latitude) : null,
        longitude: row.longitude != null ? Number(row.longitude) : null,
        createdAt: row.created_at,
        ownerId: row.owner_id,
        ownerName: row.owner_name,
        ownerPhone: row.owner_phone,
        ownerRatingCount: Number(row.owner_rating_count || 0),
        ownerFiveStarCount: Number(row.owner_five_star_count || 0),
        ownerAverageStars: Number(row.owner_average_stars || 0),
        isTopRated: maxFiveStars > 0 && Number(row.owner_five_star_count || 0) === maxFiveStars,
        availableRooms: row.available_rooms,
        minRent: Number(row.min_rent),
        roommateRequestCount: roommateByProperty.get(row.id)?.requests || 0,
        roommateMatchCount: roommateByProperty.get(row.id)?.matches || 0,
        primaryPhotoUrl: toPublicPhotoUrl(req, row.primary_photo_url),
        photos: (row.photos || []).map((pp) => ({
          id: pp.id,
          photoUrl: toPublicPhotoUrl(req, pp.photo_url),
          isPrimary: pp.is_primary,
        })),
      })),
    });
  } catch (error) {
    console.error("Browse dorms error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Returns a single active dorm with its available rooms.
router.get("/browse/dorms/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const dormResult = await pool.query(
      `
      SELECT
        p.id,
        p.name,
        p.address,
        p.description,
        p.contact_number,
        p.latitude,
        p.longitude,
        p.created_at,
        COALESCE((SELECT json_agg(json_build_object(
          'id', pp.id,
          'photo_url', pp.photo_url,
          'is_primary', pp.is_primary
        ) ORDER BY pp.is_primary DESC, pp.created_at ASC)
        FROM property_photos pp WHERE pp.property_id = p.id), '[]'::json) AS photos,
        u.id AS owner_id,
        u.name AS owner_name,
        u.phone AS owner_phone,
        ${PROPERTY_RATING_COLUMNS}
      FROM properties p
      JOIN users u ON u.id = p.owner_id AND u.role = 'owner' AND u.status = 'active'
      WHERE p.id = $1 AND p.status = 'active'
      LIMIT 1
      `,
      [id]
    );

    if (dormResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Dorm not found" });
    }

    const dorm = dormResult.rows[0];

    const roomsResult = await pool.query(
      `
      SELECT r.id, r.room_number, r.floor, r.description, r.monthly_rent, r.security_deposit,
             r.capacity, r.current_occupancy, r.amenities
      FROM rooms r
      WHERE r.property_id = $1
        AND r.status NOT IN ('maintenance', 'inactive')
        AND r.current_occupancy < r.capacity
      ORDER BY r.room_number
      `,
      [id]
    );

    const allAmenities = roomsResult.rows.reduce((acc, r) => {
      const items = Array.isArray(r.amenities) ? r.amenities : [];
      for (const a of items) {
        if (!acc.includes(a)) acc.push(a);
      }
      return acc;
    }, []);

    const roommateRequests = await roommateRequestsForProperties([id], req.user.userId);

    return res.json({
      success: true,
      data: {
        id: dorm.id,
        name: dorm.name,
        address: dorm.address,
        description: dorm.description,
        contactNumber: dorm.contact_number,
        latitude: dorm.latitude != null ? Number(dorm.latitude) : null,
        longitude: dorm.longitude != null ? Number(dorm.longitude) : null,
        amenities: allAmenities,
        createdAt: dorm.created_at,
        ownerId: dorm.owner_id,
        ownerName: dorm.owner_name,
        ownerPhone: dorm.owner_phone,
        ownerRatingCount: Number(dorm.owner_rating_count || 0),
        ownerFiveStarCount: Number(dorm.owner_five_star_count || 0),
        ownerAverageStars: Number(dorm.owner_average_stars || 0),
        photos: (dorm.photos || []).map((pp) => ({
          id: pp.id,
          photoUrl: toPublicPhotoUrl(req, pp.photo_url),
          isPrimary: pp.is_primary,
        })),
        rooms: roomsResult.rows.map((r) => ({
          id: r.id,
          roomNumber: r.room_number,
          floor: r.floor,
          description: r.description,
          monthlyRent: Number(r.monthly_rent),
          securityDeposit: Number(r.security_deposit || 0),
          capacity: r.capacity,
          currentOccupancy: r.current_occupancy,
          amenities: r.amenities,
          roommates: roommateRequests.filter((request) => request.roomId === r.id),
        })),
      },
    });
  } catch (error) {
    console.error("Browse dorm detail error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Returns a single available room detail for reservation purposes.
router.get("/browse/rooms/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const roomResult = await pool.query(
      `
      SELECT r.id, r.room_number, r.floor, r.description, r.monthly_rent, r.security_deposit,
             r.capacity, r.current_occupancy, r.amenities, r.property_id,
             p.name AS property_name, p.address, p.description AS property_description,
             p.contact_number, p.latitude, p.longitude,
             u.name AS owner_name, u.phone AS owner_phone
      FROM rooms r
      JOIN properties p ON p.id = r.property_id AND p.status = 'active'
      JOIN users u ON u.id = p.owner_id AND u.role = 'owner' AND u.status = 'active'
      WHERE r.id = $1
        AND r.status NOT IN ('maintenance', 'inactive')
        AND r.current_occupancy < r.capacity
      LIMIT 1
      `,
      [id]
    );

    if (roomResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    const room = roomResult.rows[0];
    const roommateRequests = await roommateRequestsForProperties([room.property_id], req.user.userId);

    return res.json({
      success: true,
      data: {
        id: room.id,
        roomNumber: room.room_number,
        floor: room.floor,
        description: room.description,
        monthlyRent: Number(room.monthly_rent),
        securityDeposit: Number(room.security_deposit || 0),
        capacity: room.capacity,
        currentOccupancy: room.current_occupancy,
        amenities: room.amenities,
        propertyId: room.property_id,
        propertyName: room.property_name,
        propertyAddress: room.address,
        propertyContact: room.contact_number,
        propertyLatitude: room.latitude != null ? Number(room.latitude) : null,
        propertyLongitude: room.longitude != null ? Number(room.longitude) : null,
        ownerName: room.owner_name,
        ownerPhone: room.owner_phone,
        roommates: roommateRequests.filter((request) => request.roomId === room.id),
      },
    });
  } catch (error) {
    console.error("Browse room detail error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── Reservations (tenant applies for a room) ───────
// The reservation is represented by a lease in 'pending_approval'.
// The dorm owner approves → 'active', or rejects → 'rejected'.
// The tenant id ALWAYS comes from req.user.userId; never from the body.

const RESERVATION_LIST_SQL = `
  SELECT l.id, l.status, l.requested_at, l.start_date, l.end_date, l.monthly_rent,
         l.security_deposit, l.rejection_reason, l.notes, l.created_at,
         r.id AS room_id, r.room_number, r.floor, r.capacity, r.current_occupancy,
         p.name AS property_name, p.address AS property_address, p.contact_number,
         u.id AS owner_id, u.name AS owner_name, u.phone AS owner_phone,
         rp.wants_non_smoker, rp.wants_non_drinker
  FROM leases l
  JOIN rooms r ON r.id = l.room_id
  JOIN properties p ON p.id = r.property_id
  JOIN users u ON u.id = p.owner_id AND u.role = 'owner'
  LEFT JOIN roommate_preferences rp ON rp.lease_id = l.id
  WHERE l.tenant_id = $1
  ORDER BY l.created_at DESC
`;

function mapReservation(row) {
  return {
    id: row.id,
    status: row.status,
    requestedAt: row.requested_at,
    startDate: row.start_date,
    endDate: row.end_date,
    monthlyRent: Number(row.monthly_rent),
    securityDeposit: Number(row.security_deposit || 0),
    rejectionReason: row.rejection_reason,
    notes: row.notes,
    createdAt: row.created_at,
    roomId: row.room_id,
    roomNumber: row.room_number,
    floor: row.floor,
    roomType: row.floor || null,
    capacity: row.capacity,
    currentOccupancy: row.current_occupancy,
    propertyId: row.property_id,
    propertyName: row.property_name,
    propertyAddress: row.property_address,
    propertyContact: row.contact_number,
    ownerName: row.owner_name,
    ownerPhone: row.owner_phone,
    roommatePreferences:
      row.wants_non_smoker || row.wants_non_drinker
        ? { nonSmoker: !!row.wants_non_smoker, nonDrinker: !!row.wants_non_drinker }
        : null,
  };
}

// POST /reservations — submit a reservation request for a single room.
router.post("/reservations", async (req, res) => {
  const uid = req.user.userId;
  const roomId = req.body.room_id || req.body.roomId;
  const moveInDate = req.body.move_in_date || req.body.startDate || req.body.moveInDate;
  const message = req.body.message || req.body.notes;
  const sentRoommate = req.body.roommatePreferences || req.body.roommate_preferences;
  let wantsNonSmoker = sentRoommate ? flag(sentRoommate.nonSmoker ?? sentRoommate.non_smoker) : false;
  let wantsNonDrinker = sentRoommate ? flag(sentRoommate.nonDrinker ?? sentRoommate.non_drinker) : false;

  if (!roomId) {
    return res.status(400).json({ success: false, message: "Room is required" });
  }

  if (moveInDate !== undefined && moveInDate !== null && moveInDate !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(moveInDate))) {
      return res.status(400).json({
        success: false,
        message: "Move-in date must use the format YYYY-MM-DD",
      });
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the room row so two reservations can never race on the same room.
    const roomResult = await client.query(
      `SELECT r.id, r.room_number, r.monthly_rent, r.security_deposit,
              r.status, r.capacity, r.current_occupancy, r.property_id
       FROM rooms r
       WHERE r.id = $1
       FOR UPDATE`,
      [roomId]
    );

    if (roomResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Room is no longer available." });
    }

    const room = roomResult.rows[0];

    const propertyResult = await client.query(
      `SELECT p.id, p.name AS property_name, p.owner_id, p.status, u.status AS owner_status
       FROM properties p
       JOIN users u ON u.id = p.owner_id
       WHERE p.id = $1 AND p.status = 'active' AND u.role = 'owner' AND u.status = 'active'
       LIMIT 1
       FOR UPDATE OF p`,
      [room.property_id]
    );

    if (propertyResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Room is no longer available." });
    }

    if (room.status === "maintenance" || room.status === "inactive") {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Room is no longer available." });
    }

    if (room.status === "occupied" || room.current_occupancy >= room.capacity) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "This room is already at full capacity." });
    }

    // A tenant may apply to MANY dorm owners at once, but never twice for the
    // SAME room. This keeps each application tied to a distinct available room.
    const duplicateApply = await client.query(
      `SELECT id FROM leases
       WHERE tenant_id = $1 AND room_id = $2 AND status IN ('pending_approval', 'active')
       LIMIT 1
       FOR UPDATE`,
      [uid, room.id]
    );

    if (duplicateApply.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "You already have a pending or active application for this room." });
    }

    const activeLease = await client.query(
      `SELECT id FROM leases
       WHERE tenant_id = $1 AND status = 'active'
       LIMIT 1
       FOR UPDATE`,
      [uid]
    );

    if (activeLease.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "You already have an active lease. You cannot apply for another room." });
    }

    const result = await client.query(
      `INSERT INTO leases (tenant_id, room_id, monthly_rent, security_deposit, status, requested_at, start_date, notes)
       VALUES ($1, $2, $3, $4, 'pending_approval', NOW(), $5, $6)
       RETURNING id, status, requested_at, start_date, monthly_rent, notes, created_at`,
      [
        uid,
        room.id,
        room.monthly_rent,
        room.security_deposit || 0,
        moveInDate || null,
        (message || "").toString().trim() || null,
      ]
    );

    const lease = result.rows[0];

    if (Number(room.capacity) > 1) {
      if (!sentRoommate) {
        const lifestyle = await client.query(
          `SELECT is_non_smoker, is_non_drinker FROM tenant_lifestyles WHERE tenant_id = $1`,
          [uid]
        );
        if (lifestyle.rows[0]) {
          wantsNonSmoker = lifestyle.rows[0].is_non_smoker;
          wantsNonDrinker = lifestyle.rows[0].is_non_drinker;
        }
      }
      await client.query(
        `INSERT INTO roommate_preferences (lease_id, wants_non_smoker, wants_non_drinker)
         VALUES ($1, $2, $3)`,
        [lease.id, wantsNonSmoker, wantsNonDrinker]
      );
    }

    // The reservation and the owner's notification are written in the SAME
    // transaction: if either fails the other never happens. The recipient is
    // the owner of THIS property, resolved above from rooms → properties.
    const tenantResult = await client.query(`SELECT name FROM users WHERE id = $1`, [uid]);
    await notifyReservationRequested(client, {
      ownerId: propertyResult.rows[0].owner_id,
      tenantName: tenantResult.rows[0]?.name || "A tenant",
      roomNumber: room.room_number,
      propertyName: propertyResult.rows[0].property_name,
      reservationId: lease.id,
    });

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      message: "Reservation request submitted. Waiting for the dorm owner to approve it.",
      data: {
        id: lease.id,
        status: lease.status,
        requestedAt: lease.requested_at,
        startDate: lease.start_date,
        monthlyRent: Number(lease.monthly_rent),
        notes: lease.notes,
        createdAt: lease.created_at,
        roomId: room.id,
        roomNumber: room.room_number,
        propertyId: room.property_id,
        roommatePreferences:
          wantsNonSmoker || wantsNonDrinker
            ? { nonSmoker: wantsNonSmoker, nonDrinker: wantsNonDrinker }
            : null,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Create tenant reservation error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
});

// GET /reservations — tenant's own reservation history.
router.get("/reservations", async (req, res) => {
  try {
    const uid = req.user.userId;
    const result = await pool.query(RESERVATION_LIST_SQL, [uid]);

    return res.json({
      success: true,
      data: result.rows.map(mapReservation),
    });
  } catch (error) {
    console.error("Get tenant reservations error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /reservations/:id — single reservation; tenant may only see their own.
router.get("/reservations/:id", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      `${RESERVATION_LIST_SQL.replace("WHERE l.tenant_id = $1", "WHERE l.id = $2 AND l.tenant_id = $1")}
       LIMIT 1`,
      [uid, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "You do not have permission to access this reservation.",
      });
    }

    return res.json({ success: true, data: mapReservation(result.rows[0]) });
  } catch (error) {
    console.error("Get tenant reservation error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// DELETE /reservations/:id — cancel a pending reservation.
router.delete("/reservations/:id", async (req, res) => {
  const uid = req.user.userId;
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query(
      `SELECT id, status FROM leases
       WHERE id = $1 AND tenant_id = $2
       FOR UPDATE`,
      [id, uid]
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "You do not have permission to access this reservation.",
      });
    }

    const lease = result.rows[0];

    if (lease.status !== "pending_approval") {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        message: "Reservation has already been processed.",
      });
    }

    await client.query(
      `UPDATE leases
       SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1`,
      [id]
    );

    await client.query("COMMIT");

    return res.json({
      success: true,
      message: "Reservation cancelled.",
      data: { id: lease.id, status: "cancelled" },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Cancel tenant reservation error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
});

// Backward-compatible alias used by earlier clients.
router.get("/my-reservations", async (req, res) => {
  try {
    const uid = req.user.userId;
    const result = await pool.query(RESERVATION_LIST_SQL, [uid]);
    return res.json({ success: true, data: result.rows.map(mapReservation) });
  } catch (error) {
    console.error("Get tenant reservations error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;