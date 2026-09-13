const express = require("express");
const pool = require("../db");
const requireAuth = require("../middleware/auth");
const requireRole = require("../middleware/role");

const router = express.Router();

router.use(requireAuth);
router.use(requireRole("owner"));

// Every query below is scoped to the authenticated owner. The owner's id is
// ALWAYS taken from req.user.userId and is never accepted from the client.
// Rooms reach an owner only through property → owner; payments, leases,
// maintenance and messages are joined back through the same chain.

const OWNER_ROOM_SCOPE =
  `EXISTS (SELECT 1 FROM properties __prop WHERE __prop.id = _r.property_id AND __prop.owner_id = $1)`;

// ─── Summary dashboard ──────────────────────────────────
router.get("/summary", async (req, res) => {
  try {
    const uid = req.user.userId;

    const [properties, rooms, tenants, reservations, payments, maintenance, announcements, messages] =
      await Promise.all([
        pool.query(
          `SELECT
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status = 'active')::int AS active
           FROM properties WHERE owner_id = $1`,
          [uid]
        ),
        pool.query(
          `SELECT
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status = 'available')::int AS available,
             COUNT(*) FILTER (WHERE status = 'occupied')::int AS occupied,
             COUNT(*) FILTER (WHERE status = 'maintenance')::int AS maintenance,
             COUNT(*) FILTER (WHERE status = 'inactive')::int AS inactive
           FROM rooms _r WHERE ${OWNER_ROOM_SCOPE}`,
          [uid]
        ),
        pool.query(
          `SELECT
             COUNT(DISTINCT u.id)::int AS total,
             COUNT(DISTINCT u.id) FILTER (WHERE l.status = 'active')::int AS active,
             COUNT(DISTINCT u.id) FILTER (WHERE l.status = 'pending_approval')::int AS pending,
             COUNT(DISTINCT u.id) FILTER (WHERE l.status NOT IN ('active', 'pending_approval'))::int AS inactive
           FROM users u
           JOIN leases l ON l.tenant_id = u.id
           JOIN rooms r ON r.id = l.room_id
           WHERE u.role = 'tenant'
             AND EXISTS (SELECT 1 FROM properties p WHERE p.id = r.property_id AND p.owner_id = $1)`,
          [uid]
        ),
        pool.query(
          `SELECT
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE l.status = 'pending_approval')::int AS pending_approval,
             COUNT(*) FILTER (WHERE l.status = 'active')::int AS active,
             COUNT(*) FILTER (WHERE l.status = 'rejected')::int AS rejected,
             COUNT(*) FILTER (WHERE l.status = 'cancelled')::int AS cancelled,
             COUNT(*) FILTER (WHERE l.status = 'terminated')::int AS terminated
           FROM leases l
           JOIN rooms r ON r.id = l.room_id
           WHERE EXISTS (SELECT 1 FROM properties p WHERE p.id = r.property_id AND p.owner_id = $1)`,
          [uid]
        ),
        pool.query(
          `SELECT
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE p.status = 'pending')::int AS pending,
             COUNT(*) FILTER (WHERE p.status = 'paid')::int AS paid,
             COUNT(*) FILTER (WHERE p.status = 'rejected')::int AS rejected,
             COUNT(*) FILTER (WHERE p.status = 'cancelled')::int AS cancelled,
             COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'paid'), 0)::numeric AS total_paid_amount,
             COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'pending'), 0)::numeric AS pending_amount
           FROM payments p
           JOIN leases l ON p.lease_id = l.id
           JOIN rooms r ON r.id = l.room_id
           WHERE EXISTS (SELECT 1 FROM properties prop WHERE prop.id = r.property_id AND prop.owner_id = $1)`,
          [uid]
        ),
        pool.query(
          `SELECT
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE m.status = 'pending')::int AS pending,
             COUNT(*) FILTER (WHERE m.status = 'reviewing')::int AS reviewing,
             COUNT(*) FILTER (WHERE m.status = 'in_progress')::int AS in_progress,
             COUNT(*) FILTER (WHERE m.status = 'completed')::int AS completed,
             COUNT(*) FILTER (WHERE m.status = 'cancelled')::int AS cancelled,
             COUNT(*) FILTER (WHERE m.priority IN ('high', 'urgent'))::int AS high_priority,
             ROUND(AVG(EXTRACT(EPOCH FROM (m.completed_at - m.created_at)) / 3600) FILTER (WHERE m.status = 'completed'))::int AS avg_completion_hours
           FROM maintenance_requests m
           JOIN rooms r ON r.id = m.room_id
           WHERE EXISTS (SELECT 1 FROM properties p WHERE p.id = r.property_id AND p.owner_id = $1)`,
          [uid]
        ),
        pool.query(
          `SELECT
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE a.status = 'draft')::int AS draft,
             COUNT(*) FILTER (WHERE a.status = 'published')::int AS published,
             COUNT(*) FILTER (WHERE a.status = 'archived')::int AS archived
           FROM announcements a WHERE a.owner_id = $1`,
          [uid]
        ),
        pool.query(
          `SELECT
             (SELECT COUNT(*)::int
              FROM messages m
              WHERE m.receiver_id = $1 AND NOT m.is_read
                AND EXISTS (
                  SELECT 1 FROM tenant_current_room v
                  JOIN properties p ON p.id = v.property_id
                  WHERE p.owner_id = $1 AND v.tenant_id = m.sender_id
                )
             ) AS unread,
             (SELECT COUNT(DISTINCT counterpart_id)::int
              FROM (
                SELECT CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END AS counterpart_id
                FROM messages m
                WHERE m.sender_id = $1 OR m.receiver_id = $1
              ) rel
              WHERE EXISTS (
                SELECT 1 FROM tenant_current_room v
                JOIN properties p ON p.id = v.property_id
                WHERE p.owner_id = $1 AND v.tenant_id = rel.counterpart_id
              )
             ) AS total_conversations`,
          [uid]
        ),
      ]);

    const r = rooms.rows[0];
    const ten = tenants.rows[0];
    const resv = reservations.rows[0];
    const pay = payments.rows[0];
    const maint = maintenance.rows[0];
    const ann = announcements.rows[0];
    const msg = messages.rows[0];

    return res.json({
      success: true,
      data: {
        properties: {
          total: properties.rows[0].total,
          active: properties.rows[0].active,
        },
        rooms: {
          total: r.total,
          available: r.available,
          occupied: r.occupied,
          maintenance: r.maintenance,
          inactive: r.inactive,
        },
        tenants: {
          total: ten.total,
          active: ten.active,
          pending: ten.pending,
          inactive: ten.inactive,
        },
        reservations: {
          total: resv.total,
          pendingApproval: resv.pending_approval,
          active: resv.active,
          rejected: resv.rejected,
          cancelled: resv.cancelled,
          terminated: resv.terminated,
        },
        payments: {
          total: pay.total,
          pending: pay.pending,
          paid: pay.paid,
          rejected: pay.rejected,
          cancelled: pay.cancelled,
          totalPaidAmount: Number(pay.total_paid_amount),
          pendingAmount: Number(pay.pending_amount),
        },
        maintenance: {
          total: maint.total,
          pending: maint.pending,
          reviewing: maint.reviewing,
          inProgress: maint.in_progress,
          completed: maint.completed,
          cancelled: maint.cancelled,
          highPriority: maint.high_priority,
          avgCompletionHours: maint.avg_completion_hours,
        },
        announcements: {
          total: ann.total,
          draft: ann.draft,
          published: ann.published,
          archived: ann.archived,
        },
        messages: {
          totalConversations: msg.total_conversations,
          unread: msg.unread,
        },
      },
    });
  } catch (error) {
    console.error("Owner report summary error:", error);
    return res.status(500).json({ success: false, message: "Unable to load report" });
  }
});

// ─── Property report ─────────────────────────────────────
router.get("/property", async (req, res) => {
  try {
    const uid = req.user.userId;

    const result = await pool.query(
      `SELECT p.id, p.name, p.address, p.status,
              COUNT(r.id)::int AS total_rooms,
              COALESCE(SUM(r.capacity), 0)::int AS total_capacity,
              COALESCE(SUM(r.current_occupancy), 0)::int AS current_occupancy
       FROM properties p
       LEFT JOIN rooms r ON r.property_id = p.id
       WHERE p.owner_id = $1
       GROUP BY p.id
       LIMIT 1`,
      [uid]
    );

    if (result.rows.length === 0) {
      return res.json({ success: true, data: null });
    }

    const p = result.rows[0];
    const currentOccupancy = p.current_occupancy;
    const availableSlots = Math.max(p.total_capacity - currentOccupancy, 0);
    const occupancyRate = p.total_capacity > 0 ? Math.round((currentOccupancy / p.total_capacity) * 100) : 0;

    return res.json({
      success: true,
      data: {
        id: p.id,
        name: p.name,
        location: p.address,
        status: p.status,
        totalRooms: p.total_rooms,
        totalCapacity: p.total_capacity,
        currentOccupancy,
        availableSlots,
        occupancyRate,
      },
    });
  } catch (error) {
    console.error("Owner property report error:", error);
    return res.status(500).json({ success: false, message: "Unable to load report" });
  }
});

// ─── Rooms report ────────────────────────────────────────
router.get("/rooms", async (req, res) => {
  try {
    const uid = req.user.userId;

    const [statsResult, breakdownResult] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'available')::int AS available,
           COUNT(*) FILTER (WHERE status = 'occupied')::int AS occupied,
           COUNT(*) FILTER (WHERE status = 'maintenance')::int AS maintenance,
           COUNT(*) FILTER (WHERE status = 'inactive')::int AS inactive
         FROM rooms _r WHERE ${OWNER_ROOM_SCOPE}`,
        [uid]
      ),
      pool.query(
        `SELECT r.id AS room_id, r.room_number, r.status, r.capacity, r.current_occupancy
         FROM rooms r
         WHERE EXISTS (SELECT 1 FROM properties p WHERE p.id = r.property_id AND p.owner_id = $1)
         ORDER BY r.room_number`,
        [uid]
      ),
    ]);

    const s = statsResult.rows[0];
    return res.json({
      success: true,
      data: {
        rooms: {
          total: s.total,
          available: s.available,
          occupied: s.occupied,
          maintenance: s.maintenance,
          inactive: s.inactive,
        },
        breakdown: breakdownResult.rows.map((r) => ({
          roomId: r.room_id,
          roomNumber: r.room_number,
          status: r.status,
          capacity: r.capacity,
          currentOccupancy: r.current_occupancy,
          availableSlots: Math.max(r.capacity - r.current_occupancy, 0),
        })),
      },
    });
  } catch (error) {
    console.error("Owner rooms report error:", error);
    return res.status(500).json({ success: false, message: "Unable to load report" });
  }
});

// ─── Tenants report ──────────────────────────────────────
router.get("/tenants", async (req, res) => {
  try {
    const uid = req.user.userId;

    const result = await pool.query(
      `SELECT
         COUNT(DISTINCT u.id)::int AS total,
         COUNT(DISTINCT u.id) FILTER (WHERE l.status = 'active')::int AS active,
         COUNT(DISTINCT u.id) FILTER (WHERE l.status = 'pending_approval')::int AS pending,
         COUNT(DISTINCT u.id) FILTER (WHERE l.status NOT IN ('active', 'pending_approval'))::int AS inactive
       FROM users u
       JOIN leases l ON l.tenant_id = u.id
       JOIN rooms r ON r.id = l.room_id
       WHERE u.role = 'tenant'
         AND EXISTS (SELECT 1 FROM properties p WHERE p.id = r.property_id AND p.owner_id = $1)`,
      [uid]
    );

    const t = result.rows[0];
    return res.json({
      success: true,
      data: {
        tenants: {
          total: t.total,
          active: t.active,
          pending: t.pending,
          inactive: t.inactive,
        },
      },
    });
  } catch (error) {
    console.error("Owner tenants report error:", error);
    return res.status(500).json({ success: false, message: "Unable to load report" });
  }
});

// ─── Reservations report (lease requests) ────────────────
router.get("/reservations", async (req, res) => {
  try {
    const uid = req.user.userId;

    const [statsResult, recentResult] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE l.status = 'pending_approval')::int AS pending_approval,
           COUNT(*) FILTER (WHERE l.status = 'active')::int AS active,
           COUNT(*) FILTER (WHERE l.status = 'rejected')::int AS rejected,
           COUNT(*) FILTER (WHERE l.status = 'cancelled')::int AS cancelled,
           COUNT(*) FILTER (WHERE l.status = 'terminated')::int AS terminated
         FROM leases l
         JOIN rooms r ON r.id = l.room_id
         WHERE EXISTS (SELECT 1 FROM properties p WHERE p.id = r.property_id AND p.owner_id = $1)`,
        [uid]
      ),
      pool.query(
        `SELECT l.id, l.status, l.requested_at, l.created_at,
                r.room_number, u.name AS tenant_name
         FROM leases l
         JOIN rooms r ON r.id = l.room_id
         JOIN users u ON u.id = l.tenant_id
         WHERE EXISTS (SELECT 1 FROM properties p WHERE p.id = r.property_id AND p.owner_id = $1)
         ORDER BY l.created_at DESC
         LIMIT 5`,
        [uid]
      ),
    ]);

    const s = statsResult.rows[0];
    return res.json({
      success: true,
      data: {
        reservations: {
          total: s.total,
          pendingApproval: s.pending_approval,
          active: s.active,
          rejected: s.rejected,
          cancelled: s.cancelled,
          terminated: s.terminated,
        },
        recent: recentResult.rows.map((r) => ({
          id: r.id,
          status: r.status,
          roomNumber: r.room_number,
          tenantName: r.tenant_name,
          requestedAt: r.requested_at,
        })),
      },
    });
  } catch (error) {
    console.error("Owner reservations report error:", error);
    return res.status(500).json({ success: false, message: "Unable to load report" });
  }
});

// ─── Payments report ─────────────────────────────────────
router.get("/payments", async (req, res) => {
  try {
    const uid = req.user.userId;

    const result = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE p.status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE p.status = 'paid')::int AS paid,
         COUNT(*) FILTER (WHERE p.status = 'rejected')::int AS rejected,
         COUNT(*) FILTER (WHERE p.status = 'cancelled')::int AS cancelled,
         COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'paid'), 0)::numeric AS total_paid_amount,
         COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'pending'), 0)::numeric AS pending_amount
       FROM payments p
       JOIN leases l ON p.lease_id = l.id
       JOIN rooms r ON r.id = l.room_id
       WHERE EXISTS (SELECT 1 FROM properties prop WHERE prop.id = r.property_id AND prop.owner_id = $1)`,
      [uid]
    );

    const p = result.rows[0];
    return res.json({
      success: true,
      data: {
        payments: {
          total: p.total,
          pending: p.pending,
          paid: p.paid,
          rejected: p.rejected,
          cancelled: p.cancelled,
          totalPaidAmount: Number(p.total_paid_amount),
          pendingAmount: Number(p.pending_amount),
        },
      },
    });
  } catch (error) {
    console.error("Owner payments report error:", error);
    return res.status(500).json({ success: false, message: "Unable to load report" });
  }
});

// ─── Payment trend (monthly totals, paid only) ───────────
router.get("/payment-trend", async (req, res) => {
  try {
    const uid = req.user.userId;

    const result = await pool.query(
      `SELECT TO_CHAR(p.payment_date, 'YYYY-MM') AS month,
              SUM(p.amount)::numeric AS amount,
              COUNT(*)::int AS count
       FROM payments p
       JOIN leases l ON p.lease_id = l.id
       JOIN rooms r ON r.id = l.room_id
       WHERE p.status = 'paid'
         AND EXISTS (SELECT 1 FROM properties prop WHERE prop.id = r.property_id AND prop.owner_id = $1)
       GROUP BY 1
       ORDER BY 1 DESC
       LIMIT 12`,
      [uid]
    );

    return res.json({
      success: true,
      data: result.rows
        .map((r) => ({
          period: r.month,
          amount: Number(r.amount),
          count: r.count,
        }))
        .reverse(),
    });
  } catch (error) {
    console.error("Owner payment trend error:", error);
    return res.status(500).json({ success: false, message: "Unable to load report" });
  }
});

// ─── Maintenance report ──────────────────────────────────
router.get("/maintenance", async (req, res) => {
  try {
    const uid = req.user.userId;

    const result = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE m.status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE m.status = 'reviewing')::int AS reviewing,
         COUNT(*) FILTER (WHERE m.status = 'in_progress')::int AS in_progress,
         COUNT(*) FILTER (WHERE m.status = 'completed')::int AS completed,
         COUNT(*) FILTER (WHERE m.status = 'cancelled')::int AS cancelled,
         COUNT(*) FILTER (WHERE m.priority IN ('high', 'urgent'))::int AS high_priority,
         ROUND(AVG(EXTRACT(EPOCH FROM (m.completed_at - m.created_at)) / 3600) FILTER (WHERE m.status = 'completed'))::int AS avg_completion_hours
       FROM maintenance_requests m
       JOIN rooms r ON r.id = m.room_id
       WHERE EXISTS (SELECT 1 FROM properties p WHERE p.id = r.property_id AND p.owner_id = $1)`,
      [uid]
    );

    const m = result.rows[0];
    return res.json({
      success: true,
      data: {
        maintenance: {
          total: m.total,
          pending: m.pending,
          reviewing: m.reviewing,
          inProgress: m.in_progress,
          completed: m.completed,
          cancelled: m.cancelled,
          highPriority: m.high_priority,
          avgCompletionHours: m.avg_completion_hours,
        },
      },
    });
  } catch (error) {
    console.error("Owner maintenance report error:", error);
    return res.status(500).json({ success: false, message: "Unable to load report" });
  }
});

// ─── Announcements report ────────────────────────────────
router.get("/announcements", async (req, res) => {
  try {
    const uid = req.user.userId;

    const [statsResult, recentResult] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE a.status = 'draft')::int AS draft,
           COUNT(*) FILTER (WHERE a.status = 'published')::int AS published,
           COUNT(*) FILTER (WHERE a.status = 'archived')::int AS archived
         FROM announcements a WHERE a.owner_id = $1`,
        [uid]
      ),
      pool.query(
        `SELECT id, title, status, created_at
         FROM announcements
         WHERE owner_id = $1
         ORDER BY created_at DESC
         LIMIT 5`,
        [uid]
      ),
    ]);

    const a = statsResult.rows[0];
    return res.json({
      success: true,
      data: {
        announcements: {
          total: a.total,
          draft: a.draft,
          published: a.published,
          archived: a.archived,
        },
        recent: recentResult.rows.map((r) => ({
          id: r.id,
          title: r.title,
          status: r.status,
          createdAt: r.created_at,
        })),
      },
    });
  } catch (error) {
    console.error("Owner announcements report error:", error);
    return res.status(500).json({ success: false, message: "Unable to load report" });
  }
});

// ─── Messages report (counters only, no contents) ────────
router.get("/messages", async (req, res) => {
  try {
    const uid = req.user.userId;

    const result = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int
          FROM messages m
          WHERE m.receiver_id = $1 AND NOT m.is_read
            AND EXISTS (
              SELECT 1 FROM tenant_current_room v
              JOIN properties p ON p.id = v.property_id
              WHERE p.owner_id = $1 AND v.tenant_id = m.sender_id
            )
         ) AS unread,
         (SELECT COUNT(DISTINCT counterpart_id)::int
          FROM (
            SELECT CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END AS counterpart_id
            FROM messages m
            WHERE m.sender_id = $1 OR m.receiver_id = $1
          ) rel
          WHERE EXISTS (
            SELECT 1 FROM tenant_current_room v
            JOIN properties p ON p.id = v.property_id
            WHERE p.owner_id = $1 AND v.tenant_id = rel.counterpart_id
          )
         ) AS total_conversations`,
      [uid]
    );

    return res.json({
      success: true,
      data: {
        messages: {
          totalConversations: result.rows[0].total_conversations,
          unread: result.rows[0].unread,
        },
      },
    });
  } catch (error) {
    console.error("Owner messages report error:", error);
    return res.status(500).json({ success: false, message: "Unable to load report" });
  }
});

module.exports = router;