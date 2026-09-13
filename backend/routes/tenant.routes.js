const express = require("express");
const pool = require("../db");
const requireAuth = require("../middleware/auth");
const requireRole = require("../middleware/role");

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
              p.id AS property_id, p.name AS property_name, p.address, p.contact_number
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

    const result = await pool.query(
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

    const p = result.rows[0];
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
      `SELECT v.room_id, v.room_number, v.property_id, v.property_name
       FROM tenant_current_room v
       WHERE v.tenant_id = $1
       LIMIT 1`,
      [uid]
    );
    if (roomResult.rows.length === 0) {
      return res.status(409).json({ success: false, message: "You are not assigned to an active lease yet" });
    }
    const room = roomResult.rows[0];

    const result = await pool.query(
      `INSERT INTO maintenance_requests (tenant_id, room_id, title, description, category, priority, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, tenant_id, room_id, title, description, category, priority, status, image_url, created_at, updated_at`,
      [uid, room.room_id, title, description, category || "general", priority || "medium", imageUrl || null]
    );

    const m = result.rows[0];
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
        p.created_at,
        u.name AS owner_name,
        u.phone AS owner_phone,
        COALESCE(COUNT(r.id) FILTER (WHERE r.status = 'available'), 0)::int AS available_rooms,
        COALESCE(MIN(r.monthly_rent) FILTER (WHERE r.status = 'available'), 0)::numeric AS min_rent
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

    query += ` GROUP BY p.id, u.name, u.phone ORDER BY p.created_at DESC`;

    const result = await pool.query(query, params);

    return res.json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        address: row.address,
        description: row.description,
        contactNumber: row.contact_number,
        createdAt: row.created_at,
        ownerName: row.owner_name,
        ownerPhone: row.owner_phone,
        availableRooms: row.available_rooms,
        minRent: Number(row.min_rent),
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
        p.created_at,
        u.name AS owner_name,
        u.phone AS owner_phone
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
      WHERE r.property_id = $1 AND r.status = 'available'
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

    return res.json({
      success: true,
      data: {
        id: dorm.id,
        name: dorm.name,
        address: dorm.address,
        description: dorm.description,
        contactNumber: dorm.contact_number,
        amenities: allAmenities,
        createdAt: dorm.created_at,
        ownerName: dorm.owner_name,
        ownerPhone: dorm.owner_phone,
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
             p.contact_number,
             u.name AS owner_name, u.phone AS owner_phone
      FROM rooms r
      JOIN properties p ON p.id = r.property_id AND p.status = 'active'
      JOIN users u ON u.id = p.owner_id AND u.role = 'owner' AND u.status = 'active'
      WHERE r.id = $1 AND r.status = 'available'
      LIMIT 1
      `,
      [id]
    );

    if (roomResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    const room = roomResult.rows[0];

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
        ownerName: room.owner_name,
        ownerPhone: room.owner_phone,
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
         u.id AS owner_id, u.name AS owner_name, u.phone AS owner_phone
  FROM leases l
  JOIN rooms r ON r.id = l.room_id
  JOIN properties p ON p.id = r.property_id
  JOIN users u ON u.id = p.owner_id AND u.role = 'owner'
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
  };
}

// POST /reservations — submit a reservation request for a single room.
router.post("/reservations", async (req, res) => {
  const uid = req.user.userId;
  const roomId = req.body.room_id || req.body.roomId;
  const moveInDate = req.body.move_in_date || req.body.startDate || req.body.moveInDate;
  const message = req.body.message || req.body.notes;

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
      `SELECT p.id, p.owner_id, p.status, u.status AS owner_status
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

    // A tenant may only hold one outstanding application / active lease at a time.
    const activeLease = await client.query(
      `SELECT id, status FROM leases
       WHERE tenant_id = $1 AND status IN ('pending_approval', 'active')
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [uid]
    );

    if (activeLease.rows.length > 0) {
      const existing = activeLease.rows[0];
      await client.query("ROLLBACK");
      if (existing.status === "active") {
        return res.status(409).json({ success: false, message: "You already have an active lease." });
      }
      return res.status(409).json({ success: false, message: "You already have a pending reservation for this room." });
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

    await client.query("COMMIT");

    const lease = result.rows[0];

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