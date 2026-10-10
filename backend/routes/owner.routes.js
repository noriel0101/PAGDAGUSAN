const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../db");
const requireAuth = require("../middleware/auth");
const requireRole = require("../middleware/role");
const {
  notifyReservationApproved,
  notifyReservationRejected,
  notifyPaymentVerified,
  notifyPaymentRejected,
  notifyMaintenanceUpdated,
  notifyAnnouncementPublished,
  notifyLeaseAssigned,
} = require("../services/notifications");
const { toPublicPhotoUrl, toStoredPhotoPath } = require("../lib/photoUrl");
const { formatError } = require("../lib/email");

const router = express.Router();

router.use(requireAuth);
router.use(requireRole("owner"));

// ─── Helpers ─────────────────────────────────────────────
// Rooms owned by this owner are found through the property join.
function propertyOwnerWhere(alias) {
  return `EXISTS (SELECT 1 FROM properties prop WHERE prop.id = ${alias}.property_id AND prop.owner_id = $1)`;
}

function propertyOwnerWhereIdx(alias, idx) {
  return `EXISTS (SELECT 1 FROM properties prop WHERE prop.id = ${alias}.property_id AND prop.owner_id = $${idx})`;
}

const MAX_OWNER_PROPERTIES = 3;

// A pending application on one room does not belong there once the tenant
// already has an active lease on a different room.
const HIDE_STALE_PENDING = `
  AND NOT (
    l.status = 'pending_approval'
    AND EXISTS (
      SELECT 1 FROM leases active_lease
      WHERE active_lease.tenant_id = l.tenant_id
        AND active_lease.status = 'active'
        AND active_lease.id <> l.id
    )
  )`;

async function cancelOtherPendingApplications(client, tenantId, keepLeaseId) {
  await client.query(
    `UPDATE leases
     SET status = 'cancelled',
         rejection_reason = 'Accepted for another room.',
         updated_at = NOW()
     WHERE tenant_id = $1 AND id <> $2 AND status = 'pending_approval'`,
    [tenantId, keepLeaseId]
  );
}

async function createOwnerProperty(uid, fields) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [uid]);
    const countResult = await client.query(
      `SELECT COUNT(*)::int AS total FROM properties WHERE owner_id = $1`,
      [uid]
    );
    if (countResult.rows[0].total >= MAX_OWNER_PROPERTIES) {
      const error = new Error(`You can add up to ${MAX_OWNER_PROPERTIES} properties`);
      error.status = 409;
      throw error;
    }
    const result = await client.query(
      `INSERT INTO properties (owner_id, name, address, description, contact_number, latitude, longitude, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
       RETURNING id, name, address, description, contact_number, latitude, longitude, status, created_at`,
      [
        uid,
        fields.name,
        fields.address,
        fields.description || null,
        fields.contactNumber || null,
        fields.latitude,
        fields.longitude,
      ]
    );
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {
      /* the transaction was already closed */
    }
    throw error;
  } finally {
    client.release();
  }
}

function isValidNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function isValidCapacity(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

// ─── Location (latitude / longitude) ──────────────────
// Coordinates belong to the authenticated owner's own property. They are
// optional (existing properties may have no location), but when provided both
// must be present, numeric, and within GPS bounds.
function parseCoordinate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

// Returns { latitude, longitude } when valid, or { error } when not.
function validateCoordinates(latitude, longitude) {
  const lat = parseCoordinate(latitude);
  const lng = parseCoordinate(longitude);

  if (lat === undefined || lng === undefined) {
    return { error: "Latitude and longitude must be valid numbers" };
  }
  if ((lat === null) !== (lng === null)) {
    return { error: "Both latitude and longitude are required together" };
  }
  if (lat !== null && (lat < -90 || lat > 90)) {
    return { error: "Latitude must be between -90 and 90" };
  }
  if (lng !== null && (lng < -180 || lng > 180)) {
    return { error: "Longitude must be between -180 and 180" };
  }
  return { latitude: lat, longitude: lng };
}

// ─── Maintenance workflow ────────────────────────────────
// Matches the maintenance_status enum. Owners can only move a request through
// the linear workflow (or cancel while it is still in triage).
const MAINTENANCE_TRANSITIONS = {
  pending: ["reviewing", "cancelled"],
  reviewing: ["in_progress", "cancelled"],
  in_progress: ["completed"],
  completed: [],
  cancelled: [],
};
const MAINTENANCE_STATUSES = Object.keys(MAINTENANCE_TRANSITIONS);
const MAINTENANCE_PRIORITIES = ["low", "medium", "high", "urgent"];
const MAINTENANCE_CATEGORIES = [
  "plumbing", "electrical", "appliance", "furniture", "structure",
  "internet", "pest_control", "cleaning", "security", "general", "other",
];

// ─── Dashboard Stats ─────────────────────────────────────
router.get("/stats", async (req, res) => {
  try {
    const uid = req.user.userId;

    const rooms = await pool.query(
      `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'available')::int AS available,
        COUNT(*) FILTER (WHERE status = 'occupied')::int AS occupied,
        COUNT(*) FILTER (WHERE status = 'maintenance')::int AS maintenance
       FROM rooms WHERE ${propertyOwnerWhere("rooms")}`,
      [uid]
    );

    const tenants = await pool.query(
      `SELECT COUNT(DISTINCT u.id)::int AS total
       FROM users u
       JOIN leases l ON l.tenant_id = u.id
       JOIN rooms r ON l.room_id = r.id
       WHERE u.role = 'tenant' AND ${propertyOwnerWhereIdx("r", 1)}`,
      [uid]
    );

    const payments = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE p.status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE p.status = 'paid')::int AS paid
       FROM payments p
       JOIN leases l ON p.lease_id = l.id
       JOIN rooms r ON l.room_id = r.id
       WHERE ${propertyOwnerWhereIdx("r", 1)}`,
      [uid]
    );

    const reservations = await pool.query(
      `SELECT COUNT(*)::int AS pending
       FROM leases l
       JOIN rooms r ON l.room_id = r.id
       WHERE l.status = 'pending_approval' AND ${propertyOwnerWhereIdx("r", 1)}
         ${HIDE_STALE_PENDING}`,
      [uid]
    );

    const maintenance = await pool.query(
      `SELECT COUNT(*)::int AS pending
       FROM maintenance_requests m
       JOIN rooms r ON m.room_id = r.id
       WHERE m.status = 'pending' AND ${propertyOwnerWhereIdx("r", 1)}`,
      [uid]
    );

    return res.json({
      success: true,
      data: {
        rooms: rooms.rows[0],
        tenants: tenants.rows[0],
        payments: payments.rows[0],
        reservations: reservations.rows[0],
        maintenance: maintenance.rows[0],
      },
    });
  } catch (error) {
    console.error("Owner stats error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── Dashboard ───────────────────────────────────────────
router.get("/dashboard", async (req, res) => {
  try {
    const uid = req.user.userId;

    const properties = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'active')::int AS active
       FROM properties WHERE owner_id = $1`,
      [uid]
    );

    const rooms = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'available')::int AS available,
         COUNT(*) FILTER (WHERE status = 'occupied')::int AS occupied,
         COUNT(*) FILTER (WHERE status = 'maintenance')::int AS maintenance,
         COUNT(*) FILTER (WHERE status = 'inactive')::int AS inactive
       FROM rooms WHERE ${propertyOwnerWhere("rooms")}`,
      [uid]
    );

    const tenants = await pool.query(
      `SELECT COUNT(DISTINCT u.id)::int AS total
       FROM users u
       JOIN leases l ON l.tenant_id = u.id
       JOIN rooms r ON l.room_id = r.id
       WHERE u.role = 'tenant' AND ${propertyOwnerWhereIdx("r", 1)}`,
      [uid]
    );

    const reservations = await pool.query(
      `SELECT COUNT(*)::int AS pending
       FROM leases l
       JOIN rooms r ON l.room_id = r.id
       WHERE l.status = 'pending_approval' AND ${propertyOwnerWhereIdx("r", 1)}
         ${HIDE_STALE_PENDING}`,
      [uid]
    );

    const pendingPayments = await pool.query(
      `SELECT COUNT(*)::int AS pending
       FROM payments p
       JOIN leases l ON p.lease_id = l.id
       JOIN rooms r ON l.room_id = r.id
       WHERE p.status = 'pending' AND ${propertyOwnerWhereIdx("r", 1)}`,
      [uid]
    );

    const openMaintenance = await pool.query(
      `SELECT COUNT(*)::int AS open
       FROM maintenance_requests m
       JOIN rooms r ON m.room_id = r.id
       WHERE m.status IN ('pending', 'reviewing', 'in_progress') AND ${propertyOwnerWhereIdx("r", 1)}`,
      [uid]
    );

    return res.json({
      success: true,
      data: {
        properties: properties.rows[0],
        rooms: rooms.rows[0],
        tenants: tenants.rows[0],
        reservations: reservations.rows[0],
        pendingPayments: pendingPayments.rows[0],
        openMaintenance: openMaintenance.rows[0],
      },
    });
  } catch (error) {
    console.error("Owner dashboard error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── Reports ─────────────────────────────────────────────
router.get("/reports", async (req, res) => {
  try {
    const uid = req.user.userId;

    const revenue = await pool.query(
      `SELECT
         COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'paid'), 0)::numeric AS collected,
         COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'pending'), 0)::numeric AS pending_amount,
         COUNT(*) FILTER (WHERE p.status = 'paid')::int AS paid_count,
         COUNT(*) FILTER (WHERE p.status = 'pending')::int AS pending_count
       FROM payments p
       JOIN leases l ON p.lease_id = l.id
       JOIN rooms r ON l.room_id = r.id
       WHERE ${propertyOwnerWhereIdx("r", 1)}`,
      [uid]
    );

    const occupancy = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'occupied')::int AS occupied,
         COUNT(*) FILTER (WHERE status = 'available')::int AS available,
         COUNT(*) FILTER (WHERE status = 'maintenance')::int AS maintenance
       FROM rooms WHERE ${propertyOwnerWhere("rooms")}`,
      [uid]
    );

    const byProperty = await pool.query(
      `SELECT p.id, p.name,
         COUNT(r.id)::int AS total_rooms,
         COUNT(r.id) FILTER (WHERE r.status = 'occupied')::int AS occupied_rooms,
         COUNT(r.id) FILTER (WHERE r.status = 'available')::int AS available_rooms
       FROM properties p
       LEFT JOIN rooms r ON r.property_id = p.id
       WHERE p.owner_id = $1
       GROUP BY p.id, p.name
       ORDER BY p.name`,
      [uid]
    );

    const monthly = await pool.query(
      `SELECT
         TO_CHAR(p.payment_date, 'YYYY-MM') AS period,
         SUM(p.amount)::numeric AS amount,
         COUNT(*)::int AS count
       FROM payments p
       JOIN leases l ON p.lease_id = l.id
       JOIN rooms r ON l.room_id = r.id
       WHERE p.status = 'paid' AND ${propertyOwnerWhereIdx("r", 1)}
       GROUP BY 1
       ORDER BY 1 DESC
       LIMIT 12`,
      [uid]
    );

    return res.json({
      success: true,
      data: {
        revenue: revenue.rows[0],
        occupancy: occupancy.rows[0],
        byProperty: byProperty.rows.map((p) => ({
          id: p.id,
          name: p.name,
          totalRooms: p.total_rooms,
          occupiedRooms: p.occupied_rooms,
          availableRooms: p.available_rooms,
          occupancyRate:
            p.total_rooms > 0 ? Math.round((p.occupied_rooms / p.total_rooms) * 100) : 0,
        })),
        monthly: monthly.rows.map((m) => ({
          period: m.period,
          amount: Number(m.amount),
          count: m.count,
        })),
      },
    });
  } catch (error) {
    console.error("Owner reports error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── Properties ──────────────────────────────────────────
router.get("/properties", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { search } = req.query;

    let query = `
      SELECT p.id, p.name, p.address, p.description, p.contact_number, p.status, p.created_at,
             p.latitude, p.longitude,
             COUNT(r.id)::int AS total_rooms,
             COUNT(r.id) FILTER (WHERE r.status = 'available')::int AS available_rooms,
             COUNT(r.id) FILTER (WHERE r.status = 'occupied')::int AS occupied_rooms,
             COUNT(r.id) FILTER (WHERE r.status = 'maintenance')::int AS maintenance_rooms
      FROM properties p
      LEFT JOIN rooms r ON r.property_id = p.id
      WHERE p.owner_id = $1
    `;
    const params = [uid];

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (LOWER(p.name) LIKE LOWER($${params.length}) OR LOWER(p.address) LIKE LOWER($${params.length}))`;
    }

    query += ` GROUP BY p.id ORDER BY p.name`;

    const result = await pool.query(query, params);

    return res.json({
      success: true,
      data: result.rows.map((p) => ({
        id: p.id,
        name: p.name,
        address: p.address,
        description: p.description,
        contactNumber: p.contact_number,
        latitude: p.latitude != null ? Number(p.latitude) : null,
        longitude: p.longitude != null ? Number(p.longitude) : null,
        status: p.status,
        createdAt: p.created_at,
        totalRooms: p.total_rooms,
        availableRooms: p.available_rooms,
        occupiedRooms: p.occupied_rooms,
        maintenanceRooms: p.maintenance_rooms,
      })),
    });
  } catch (error) {
    console.error("Get properties error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post("/properties", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { name, address, description, contactNumber, latitude, longitude } = req.body;

    if (!name || !address) {
      return res.status(400).json({ success: false, message: "Name and address are required" });
    }

    const coords = validateCoordinates(latitude, longitude);
    if (coords.error) {
      return res.status(400).json({ success: false, message: coords.error });
    }

    const p = await createOwnerProperty(uid, {
      name,
      address,
      description,
      contactNumber,
      latitude: coords.latitude,
      longitude: coords.longitude,
    });
    return res.status(201).json({
      success: true,
      message: "Property created",
      data: {
        id: p.id,
        name: p.name,
        address: p.address,
        description: p.description,
        contactNumber: p.contact_number,
        latitude: p.latitude != null ? Number(p.latitude) : null,
        longitude: p.longitude != null ? Number(p.longitude) : null,
        status: p.status,
        createdAt: p.created_at,
        totalRooms: 0,
        availableRooms: 0,
        occupiedRooms: 0,
        maintenanceRooms: 0,
      },
    });
  } catch (error) {
    if (error.status === 409) {
      return res.status(409).json({ success: false, message: error.message });
    }
    console.error("Create property error:", error);
    if (error.code === "23505") {
      return res.status(409).json({ success: false, message: `You can add up to ${MAX_OWNER_PROPERTIES} properties` });
    }
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/property", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.name, p.address, p.description, p.contact_number, p.latitude, p.longitude, p.status, p.created_at, p.updated_at,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'id', pp.id,
                  'photo_url', pp.photo_url,
                  'is_primary', pp.is_primary
                ) ORDER BY pp.is_primary DESC, pp.created_at ASC)
                FROM property_photos pp WHERE pp.property_id = p.id
              ), '[]'::json) AS photos
       FROM properties p WHERE p.owner_id = $1 LIMIT 1`,
      [req.user.userId]
    );
    const p = result.rows[0] || null;
    return res.json({
      success: true,
      data: p
        ? {
            ...p,
            latitude: p.latitude != null ? Number(p.latitude) : null,
            longitude: p.longitude != null ? Number(p.longitude) : null,
            photos: (p.photos || []).map((pp) => ({
              id: pp.id,
              photoUrl: toPublicPhotoUrl(req, pp.photo_url),
              isPrimary: pp.is_primary,
            })),
          }
        : null,
    });
  } catch (error) {
    console.error("Get owner property error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post("/property", async (req, res) => {
  try {
    const { name, address, description, contactNumber, latitude, longitude } = req.body;
    if (!name || !address) {
      return res.status(400).json({ success: false, message: "Name and address are required" });
    }

    const coords = validateCoordinates(latitude, longitude);
    if (coords.error) {
      return res.status(400).json({ success: false, message: coords.error });
    }

    const p = await createOwnerProperty(req.user.userId, {
      name: name.trim(),
      address: address.trim(),
      description,
      contactNumber,
      latitude: coords.latitude,
      longitude: coords.longitude,
    });
    return res.status(201).json({
      success: true,
      message: "Property created",
      data: {
        ...p,
        latitude: p.latitude != null ? Number(p.latitude) : null,
        longitude: p.longitude != null ? Number(p.longitude) : null,
      },
    });
  } catch (error) {
    if (error.status === 409) {
      return res.status(409).json({ success: false, message: error.message });
    }
    console.error("Create owner property error:", error);
    if (error.code === "23505") {
      return res.status(409).json({ success: false, message: `You can add up to ${MAX_OWNER_PROPERTIES} properties` });
    }
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.put("/property", async (req, res) => {
  try {
    const { name, address, description, contactNumber, latitude, longitude } = req.body;
    if (!name || !address) {
      return res.status(400).json({ success: false, message: "Name and address are required" });
    }

    const coords = validateCoordinates(latitude, longitude);
    if (coords.error) {
      return res.status(400).json({ success: false, message: coords.error });
    }

    const result = await pool.query(
      `UPDATE properties
       SET name = $1, address = $2, description = $3, contact_number = $4,
           latitude = COALESCE($5, latitude), longitude = COALESCE($6, longitude), updated_at = NOW()
       WHERE id = (
         SELECT id FROM properties WHERE owner_id = $7 ORDER BY created_at ASC LIMIT 1
       )
       RETURNING id, name, address, description, contact_number, latitude, longitude, status, updated_at`,
      [name.trim(), address.trim(), description || null, contactNumber || null,
        coords.latitude, coords.longitude, req.user.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Property not found" });
    }
    const p = result.rows[0];
    return res.json({
      success: true,
      message: "Property updated",
      data: {
        ...p,
        latitude: p.latitude != null ? Number(p.latitude) : null,
        longitude: p.longitude != null ? Number(p.longitude) : null,
      },
    });
  } catch (error) {
    console.error("Update owner property error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/properties/:id", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      `SELECT p.id, p.name, p.address, p.description, p.contact_number, p.status, p.created_at, p.updated_at,
              p.latitude, p.longitude,
              COUNT(r.id)::int AS total_rooms,
              COUNT(r.id) FILTER (WHERE r.status = 'available')::int AS available_rooms,
              COUNT(r.id) FILTER (WHERE r.status = 'occupied')::int AS occupied_rooms,
              COUNT(r.id) FILTER (WHERE r.status = 'maintenance')::int AS maintenance_rooms,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'id', pp.id,
                  'photo_url', pp.photo_url,
                  'is_primary', pp.is_primary
                ) ORDER BY pp.is_primary DESC, pp.created_at ASC)
                FROM property_photos pp WHERE pp.property_id = p.id
              ), '[]'::json) AS photos
       FROM properties p
       LEFT JOIN rooms r ON r.property_id = p.id
       WHERE p.id = $2 AND p.owner_id = $1
       GROUP BY p.id`,
      [uid, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Property not found" });
    }

    const p = result.rows[0];
    return res.json({
      success: true,
      data: {
        id: p.id,
        name: p.name,
        address: p.address,
        description: p.description,
        contactNumber: p.contact_number,
        latitude: p.latitude != null ? Number(p.latitude) : null,
        longitude: p.longitude != null ? Number(p.longitude) : null,
        status: p.status,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        totalRooms: p.total_rooms,
        availableRooms: p.available_rooms,
        occupiedRooms: p.occupied_rooms,
        maintenanceRooms: p.maintenance_rooms,
        photos: (p.photos || []).map((pp) => ({
          id: pp.id,
          photoUrl: toPublicPhotoUrl(req, pp.photo_url),
          isPrimary: pp.is_primary,
        })),
      },
    });
  } catch (error) {
    console.error("Get property error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.put("/properties/:id", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;
    const { name, address, description, contactNumber, latitude, longitude } = req.body;

    if (!name || !address) {
      return res.status(400).json({ success: false, message: "Name and address are required" });
    }

    const coords = validateCoordinates(latitude, longitude);
    if (coords.error) {
      return res.status(400).json({ success: false, message: coords.error });
    }

    // A property owned by someone else is reported exactly like one that does
    // not exist, so probing ids can never confirm that another owner's property
    // is real. The UPDATE below stays scoped by owner_id as well, so the write
    // itself matches 0 rows even if this guard were ever bypassed.
    const exists = await pool.query(`SELECT id FROM properties WHERE id = $1 AND owner_id = $2`, [id, uid]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Property not found" });
    }

    const result = await pool.query(
      `UPDATE properties
       SET name = $1,
           address = $2,
           description = COALESCE($3, description),
           contact_number = COALESCE($4, contact_number),
           latitude = COALESCE($5, latitude),
           longitude = COALESCE($6, longitude),
           updated_at = NOW()
       WHERE id = $7 AND owner_id = $8
       RETURNING id, name, address, description, contact_number, latitude, longitude, status`,
      [
        name,
        address,
        description || null,
        contactNumber || null,
        coords.latitude,
        coords.longitude,
        id,
        uid,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Property not found" });
    }

    const p = result.rows[0];
    return res.json({
      success: true,
      message: "Property updated",
      data: {
        id: p.id,
        name: p.name,
        address: p.address,
        description: p.description,
        contactNumber: p.contact_number,
        latitude: p.latitude != null ? Number(p.latitude) : null,
        longitude: p.longitude != null ? Number(p.longitude) : null,
        status: p.status,
      },
    });
  } catch (error) {
    console.error("Update property error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.patch("/properties/:id/status", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !["active", "inactive"].includes(status)) {
      return res.status(400).json({ success: false, message: "Status must be 'active' or 'inactive'" });
    }

    const result = await pool.query(
      `UPDATE properties
       SET status = $1, updated_at = NOW()
       WHERE id = $2 AND owner_id = $3
       RETURNING id, status`,
      [status, id, uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Property not found" });
    }

    return res.json({
      success: true,
      message: "Property status updated",
      data: { id: result.rows[0].id, status: result.rows[0].status },
    });
  } catch (error) {
    console.error("Update property status error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Save (or clear) the dorm's map location. Passing null for both coordinates
// removes the location. Cross-owner access is deliberately NOT distinguished
// from a missing property: both answer 404 "Property not found", so probing
// ids cannot confirm that another owner's property exists.
router.patch("/properties/:id/location", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;
    const { latitude, longitude } = req.body;

    const coords = validateCoordinates(latitude, longitude);
    if (coords.error) {
      return res.status(400).json({ success: false, message: coords.error });
    }

    const exists = await pool.query(`SELECT id FROM properties WHERE id = $1 AND owner_id = $2`, [id, uid]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Property not found" });
    }

    const result = await pool.query(
      `UPDATE properties
       SET latitude = $1, longitude = $2, updated_at = NOW()
       WHERE id = $3 AND owner_id = $4
       RETURNING id, latitude, longitude, updated_at`,
      [coords.latitude, coords.longitude, id, uid]
    );

    const p = result.rows[0];
    return res.json({
      success: true,
      message: "Property location updated",
      data: {
        id: p.id,
        latitude: p.latitude != null ? Number(p.latitude) : null,
        longitude: p.longitude != null ? Number(p.longitude) : null,
        updatedAt: p.updated_at,
      },
    });
  } catch (error) {
    console.error("Update property location error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/properties/:propertyId/rooms", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { propertyId } = req.params;
    const { search, status } = req.query;

    const propCheck = await pool.query(
      `SELECT id FROM properties WHERE id = $1 AND owner_id = $2`,
      [propertyId, uid]
    );
    if (propCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Property not found" });
    }

    let query = `
      SELECT r.id, r.room_number, r.floor, r.description, r.monthly_rent, r.security_deposit,
             r.capacity, r.current_occupancy, r.status, r.amenities, r.created_at,
             p.name AS property_name
      FROM rooms r
      JOIN properties p ON r.property_id = p.id
      WHERE r.property_id = $1
    `;
    const params = [propertyId];
    let idx = 2;

    if (search) {
      query += ` AND LOWER(r.room_number) LIKE LOWER($${idx})`;
      params.push(`%${search}%`);
      idx++;
    }
    if (status && status !== "all") {
      query += ` AND r.status = $${idx}`;
      params.push(status);
      idx++;
    }

    query += ` ORDER BY r.created_at DESC`;

    const result = await pool.query(query, params);

    return res.json({
      success: true,
      data: result.rows.map((r) => ({
        id: r.id,
        roomNumber: r.room_number,
        floor: r.floor,
        description: r.description,
        monthlyRent: r.monthly_rent,
        securityDeposit: r.security_deposit,
        capacity: r.capacity,
        currentOccupancy: r.current_occupancy,
        status: r.status,
        amenities: r.amenities || [],
        createdAt: r.created_at,
        propertyId,
        propertyName: r.property_name,
      })),
    });
  } catch (error) {
    console.error("Get property rooms error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post("/properties/:propertyId/rooms", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { propertyId } = req.params;
    const { roomNumber, monthlyRent, capacity, floor, securityDeposit, description, amenities } = req.body;

    if (!roomNumber || monthlyRent == null) {
      return res.status(400).json({ success: false, message: "Room number and rent are required" });
    }
    if (!isValidNumber(monthlyRent) || Number(monthlyRent) < 0) {
      return res.status(400).json({ success: false, message: "Rent must be non-negative" });
    }
    if (capacity != null && !isValidCapacity(capacity)) {
      return res.status(400).json({ success: false, message: "Capacity must be at least 1" });
    }

    // Owner-scoped: a property that isn't this owner's returns no rows, exactly
    // like a missing one, so 404 discloses nothing about other owners.
    const propCheck = await pool.query(
      `SELECT id FROM properties WHERE id = $1 AND owner_id = $2`,
      [propertyId, uid]
    );
    if (propCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Property not found" });
    }

    const dupCheck = await pool.query(
      `SELECT id FROM rooms WHERE property_id = $1 AND room_number = $2`,
      [propertyId, roomNumber]
    );
    if (dupCheck.rows.length > 0) {
      return res.status(409).json({ success: false, message: "Room number already exists in this property" });
    }

    const result = await pool.query(
      `INSERT INTO rooms (property_id, room_number, monthly_rent, capacity, floor, security_deposit, description, amenities, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'available')
       RETURNING id, room_number, monthly_rent, capacity, status, amenities, created_at`,
      [
        propertyId,
        roomNumber,
        monthlyRent,
        capacity || 1,
        floor || null,
        securityDeposit || 0,
        description || null,
        JSON.stringify(amenities || []),
      ]
    );

    const r = result.rows[0];
    return res.status(201).json({
      success: true,
      message: "Room created",
      data: {
        id: r.id,
        roomNumber: r.room_number,
        monthlyRent: r.monthly_rent,
        capacity: r.capacity,
        status: r.status,
        amenities: r.amenities || [],
        createdAt: r.created_at,
        propertyId,
      },
    });
  } catch (error) {
    console.error("Create property room error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── Rooms ───────────────────────────────────────────────
router.get("/rooms", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { search, status, property_id } = req.query;
    let query = `
      SELECT r.id, r.room_number, r.floor, r.description, r.monthly_rent, r.security_deposit,
             r.capacity, r.current_occupancy, r.status, r.amenities, r.created_at,
             p.id AS property_id, p.name AS property_name
      FROM rooms r
      LEFT JOIN properties p ON r.property_id = p.id
      WHERE ${propertyOwnerWhere("r")}
    `;
    const params = [uid];
    let idx = 2;

    if (search) {
      query += ` AND (LOWER(r.room_number) LIKE LOWER($${idx}) OR LOWER(p.name) LIKE LOWER($${idx}))`;
      params.push(`%${search}%`);
      idx++;
    }
    if (status && status !== "all") {
      query += ` AND r.status = $${idx}`;
      params.push(status);
      idx++;
    }
    if (property_id) {
      query += ` AND r.property_id = $${idx}`;
      params.push(property_id);
      idx++;
    }

    query += ` ORDER BY r.created_at DESC`;

    const result = await pool.query(query, params);

    return res.json({
      success: true,
      data: result.rows.map((r) => ({
        id: r.id,
        roomNumber: r.room_number,
        floor: r.floor,
        description: r.description,
        monthlyRent: r.monthly_rent,
        securityDeposit: r.security_deposit,
        capacity: r.capacity,
        currentOccupancy: r.current_occupancy,
        status: r.status,
        amenities: r.amenities || [],
        createdAt: r.created_at,
        propertyId: r.property_id,
        propertyName: r.property_name,
      })),
    });
  } catch (error) {
    console.error("Get rooms error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/rooms/:id", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      `SELECT r.id, r.room_number, r.floor, r.description, r.monthly_rent, r.security_deposit,
              r.capacity, r.current_occupancy, r.status, r.amenities, r.created_at, r.updated_at,
              p.id AS property_id, p.name AS property_name, p.address AS property_address, p.contact_number
       FROM rooms r
       LEFT JOIN properties p ON r.property_id = p.id
       WHERE r.id = $2 AND ${propertyOwnerWhereIdx("r", 1)}`,
      [uid, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    const room = result.rows[0];

    const tenantsResult = await pool.query(
      `SELECT DISTINCT u.id, u.name, u.email, u.phone
       FROM users u
       JOIN leases l ON l.tenant_id = u.id
       WHERE l.room_id = $1 AND l.status IN ('active', 'pending_approval')
         ${HIDE_STALE_PENDING}
       ORDER BY u.name`,
      [id]
    );

    return res.json({
      success: true,
      data: {
        id: room.id,
        roomNumber: room.room_number,
        floor: room.floor,
        description: room.description,
        monthlyRent: room.monthly_rent,
        securityDeposit: room.security_deposit,
        capacity: room.capacity,
        currentOccupancy: room.current_occupancy,
        status: room.status,
        amenities: room.amenities || [],
        createdAt: room.created_at,
        updatedAt: room.updated_at,
        propertyId: room.property_id,
        propertyName: room.property_name,
        propertyAddress: room.property_address,
        propertyContact: room.contact_number,
        tenants: tenantsResult.rows,
      },
    });
  } catch (error) {
    console.error("Get room error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post("/rooms", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { propertyId, roomNumber, monthlyRent, capacity, floor, securityDeposit, description, amenities } = req.body;

    if (!propertyId || !roomNumber || monthlyRent == null) {
      return res.status(400).json({ success: false, message: "Property, room number, and rent are required" });
    }
    if (!isValidNumber(monthlyRent) || Number(monthlyRent) < 0) {
      return res.status(400).json({ success: false, message: "Rent must be non-negative" });
    }
    if (capacity != null && !isValidCapacity(capacity)) {
      return res.status(400).json({ success: false, message: "Capacity must be at least 1" });
    }

    // Owner-scoped: a property that isn't this owner's returns no rows, exactly
    // like a missing one, so 404 discloses nothing about other owners.
    const propCheck = await pool.query(
      `SELECT id FROM properties WHERE id = $1 AND owner_id = $2`,
      [propertyId, uid]
    );
    if (propCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Property not found" });
    }

    const dupCheck = await pool.query(
      `SELECT id FROM rooms WHERE property_id = $1 AND room_number = $2`,
      [propertyId, roomNumber]
    );
    if (dupCheck.rows.length > 0) {
      return res.status(409).json({ success: false, message: "Room number already exists in this property" });
    }

    const result = await pool.query(
      `INSERT INTO rooms (property_id, room_number, monthly_rent, capacity, floor, security_deposit, description, amenities, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'available')
       RETURNING id, room_number, monthly_rent, capacity, status, amenities, created_at`,
      [
        propertyId,
        roomNumber,
        monthlyRent,
        capacity || 1,
        floor || null,
        securityDeposit || 0,
        description || null,
        JSON.stringify(amenities || []),
      ]
    );

    const r = result.rows[0];
    return res.status(201).json({
      success: true,
      message: "Room created",
      data: {
        id: r.id,
        roomNumber: r.room_number,
        monthlyRent: r.monthly_rent,
        capacity: r.capacity,
        status: r.status,
        amenities: r.amenities || [],
        createdAt: r.created_at,
      },
    });
  } catch (error) {
    console.error("Create room error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.put("/rooms/:id", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;
    const { roomNumber, monthlyRent, capacity, floor, securityDeposit, description, amenities } = req.body;

    if (!roomNumber || monthlyRent == null) {
      return res.status(400).json({ success: false, message: "Room number and rent are required" });
    }
    if (!isValidNumber(monthlyRent) || Number(monthlyRent) < 0) {
      return res.status(400).json({ success: false, message: "Rent must be non-negative" });
    }
    if (!isValidCapacity(capacity)) {
      return res.status(400).json({ success: false, message: "Capacity must be at least 1" });
    }

    const result = await pool.query(
      `UPDATE rooms
       SET room_number = $1,
           monthly_rent = $2,
           capacity = $3,
           floor = $4,
           security_deposit = $5,
           description = $6,
           amenities = $7,
           updated_at = NOW()
       WHERE id = $8 AND ${propertyOwnerWhereIdx("rooms", 9)}
       RETURNING id, room_number, monthly_rent, capacity, status, floor, security_deposit, description, amenities`,
      [roomNumber, monthlyRent, capacity || 1, floor || null, securityDeposit || 0, description || null, JSON.stringify(amenities || []), id, uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    const r = result.rows[0];
    return res.json({
      success: true,
      message: "Room updated",
      data: {
        id: r.id,
        roomNumber: r.room_number,
        monthlyRent: r.monthly_rent,
        capacity: r.capacity,
        status: r.status,
        floor: r.floor,
        securityDeposit: r.security_deposit,
        description: r.description,
        amenities: r.amenities || [],
      },
    });
  } catch (error) {
    console.error("Update room error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.patch("/rooms/:id/status", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !["available", "maintenance", "inactive"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid room status" });
    }

    const result = await pool.query(
      `UPDATE rooms
       SET status = $1,
           updated_at = NOW()
       WHERE id = $2 AND ${propertyOwnerWhereIdx("rooms", 3)}
       RETURNING id, status`,
      [status, id, uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    return res.json({
      success: true,
      message: "Room status updated",
      data: { id: result.rows[0].id, status: result.rows[0].status },
    });
  } catch (error) {
    console.error("Update room status error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.patch("/rooms/:id", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;
    const { roomNumber, monthlyRent, capacity, status, floor, securityDeposit, description } = req.body;

    if (status && !["available", "occupied", "maintenance", "inactive"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid room status" });
    }

    const result = await pool.query(
      `UPDATE rooms
       SET room_number = COALESCE($1, room_number),
           monthly_rent = COALESCE($2, monthly_rent),
           capacity = COALESCE($3, capacity),
           status = COALESCE($4, status),
           floor = COALESCE($5, floor),
           security_deposit = COALESCE($6, security_deposit),
           description = COALESCE($7, description),
           updated_at = NOW()
       WHERE id = $8 AND ${propertyOwnerWhereIdx("rooms", 9)}
       RETURNING id, room_number, monthly_rent, capacity, status`,
      [roomNumber || null, monthlyRent, capacity || null, status || null, floor || null, securityDeposit || null, description || null, id, uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    const r = result.rows[0];
    return res.json({
      success: true,
      message: "Room updated",
      data: {
        id: r.id,
        roomNumber: r.room_number,
        monthlyRent: r.monthly_rent,
        capacity: r.capacity,
        status: r.status,
      },
    });
  } catch (error) {
    console.error("Update room error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.delete("/rooms/:id", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;

    const ownedRoom = await pool.query(
      `SELECT r.id FROM rooms r WHERE r.id = $1 AND ${propertyOwnerWhereIdx("r", 2)}`,
      [id, uid]
    );
    if (ownedRoom.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    const activeLeases = await pool.query(
      `SELECT l.id FROM leases l
       WHERE l.room_id = $1 AND l.status IN ('active', 'pending_approval')`,
      [id]
    );
    if (activeLeases.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete room with active or pending leases",
      });
    }

    const result = await pool.query(
      `DELETE FROM rooms
       WHERE id = $1 AND ${propertyOwnerWhereIdx("rooms", 2)}
       RETURNING id`,
      [id, uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    return res.json({ success: true, message: "Room deleted" });
  } catch (error) {
    console.error("Delete room error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── Tenants ─────────────────────────────────────────────
router.get("/tenants", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { search, status } = req.query;

    let query = `
      SELECT DISTINCT ON (u.id)
             u.id, u.name, u.email, u.phone, u.status AS account_status, u.created_at,
             r.id AS room_id, r.room_number, r.monthly_rent,
             p.id AS property_id, p.name AS property_name,
             l.id AS lease_id, l.start_date, l.end_date, l.status AS lease_status
       FROM users u
       JOIN leases l ON l.tenant_id = u.id
       JOIN rooms r ON l.room_id = r.id
       JOIN properties p ON r.property_id = p.id
       WHERE u.role = 'tenant' AND p.owner_id = $1
    `;
    const params = [uid];
    let idx = 2;

    if (search) {
      query += ` AND (LOWER(u.name) LIKE LOWER($${idx}) OR LOWER(u.email) LIKE LOWER($${idx}))`;
      params.push(`%${search}%`);
      idx++;
    }
    if (status && status !== "all") {
      query += ` AND l.status = $${idx}`;
      params.push(status);
      idx++;
    }

    query += ` ORDER BY u.id, CASE WHEN l.status = 'active' THEN 0 ELSE 1 END, l.created_at DESC`;

    const result = await pool.query(query, params);

    return res.json({
      success: true,
      data: result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        phone: r.phone,
        accountStatus: r.account_status,
        createdAt: r.created_at,
        roomId: r.room_id,
        roomNumber: r.room_number,
        monthlyRent: r.monthly_rent,
        propertyId: r.property_id,
        propertyName: r.property_name,
        leaseId: r.lease_id,
        leaseStatus: r.lease_status,
        startDate: r.start_date,
        endDate: r.end_date,
      })),
    });
  } catch (error) {
    console.error("Get tenants error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/tenants/:id", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      `SELECT DISTINCT ON (u.id)
              u.id, u.name, u.email, u.phone, u.status AS account_status, u.created_at,
              r.id AS room_id, r.room_number, r.monthly_rent,
              p.name AS property_name, p.address AS property_address,
              l.id AS lease_id, l.start_date, l.end_date, l.status AS lease_status
       FROM users u
       JOIN leases l ON l.tenant_id = u.id
       JOIN rooms r ON l.room_id = r.id
       JOIN properties p ON r.property_id = p.id
       WHERE u.id = $2 AND p.owner_id = $1
       ORDER BY u.id, CASE WHEN l.status = 'active' THEN 0 ELSE 1 END, l.created_at DESC`,
      [uid, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Tenant not found" });
    }

    const t = result.rows[0];

    const paymentsResult = await pool.query(
      `SELECT p.id, p.amount, p.payment_method, p.status, p.payment_date,
              p.billing_period_start, p.billing_period_end, p.reference_number, p.created_at
       FROM payments p
       JOIN leases l ON p.lease_id = l.id
       JOIN rooms r ON l.room_id = r.id
       WHERE l.tenant_id = $1 AND ${propertyOwnerWhereIdx("r", 2)}
       ORDER BY p.created_at DESC`,
      [id, uid]
    );

    return res.json({
      success: true,
      data: {
        id: t.id,
        name: t.name,
        email: t.email,
        phone: t.phone,
        accountStatus: t.account_status,
        createdAt: t.created_at,
        roomId: t.room_id,
        roomNumber: t.room_number,
        monthlyRent: t.monthly_rent,
        propertyName: t.property_name,
        propertyAddress: t.property_address,
        leaseId: t.lease_id,
        leaseStatus: t.lease_status,
        startDate: t.start_date,
        endDate: t.end_date,
        payments: paymentsResult.rows.map((p) => ({
          id: p.id,
          amount: p.amount,
          paymentMethod: p.payment_method,
          status: p.status,
          paymentDate: p.payment_date,
          billingPeriodStart: p.billing_period_start,
          billingPeriodEnd: p.billing_period_end,
          referenceNumber: p.reference_number,
          createdAt: p.created_at,
        })),
      },
    });
  } catch (error) {
    console.error("Get tenant error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Create a tenant user account and optionally assign a room via a lease.
router.post("/tenants", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { name, email, phone, password, roomId, startDate } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: "Name, email, and password are required" });
    }

    const emailError = formatError(email);
    if (emailError) {
      return res.status(400).json({ success: false, message: emailError });
    }
    const normalizedEmail = String(email).trim().toLowerCase();

    const existing = await pool.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1)`,
      [normalizedEmail]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, message: "An account with this email already exists" });
    }

    let room = null;
    if (roomId) {
      const roomResult = await pool.query(
        `SELECT r.id, r.monthly_rent, r.status, r.capacity, r.current_occupancy, r.security_deposit, r.property_id
         FROM rooms r
         WHERE r.id = $2 AND ${propertyOwnerWhereIdx("r", 1)}`,
        [uid, roomId]
      );
      if (roomResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: "Room not found" });
      }
      room = roomResult.rows[0];
      if (room.status === "inactive" || room.status === "maintenance") {
        return res.status(409).json({ success: false, message: "Room is not available" });
      }
      if (room.current_occupancy >= room.capacity) {
        return res.status(409).json({ success: false, message: "Room is at full capacity" });
      }
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const client = await pool.connect();
    let user = null;
    let lease = null;
    try {
      await client.query("BEGIN");
      const userResult = await client.query(
        `INSERT INTO users (name, email, phone, password_hash, role, status, email_verified)
         VALUES ($1, $2, $3, $4, 'tenant', 'active', false)
         RETURNING id, name, email, phone, role, status, created_at`,
        [name, normalizedEmail, phone || null, passwordHash]
      );
      user = userResult.rows[0];

      if (room) {
        const leaseResult = await client.query(
          `INSERT INTO leases (tenant_id, room_id, monthly_rent, security_deposit, status, start_date)
           VALUES ($1, $2, $3, $4, 'active', $5)
           RETURNING id, tenant_id, room_id, start_date, monthly_rent, status`,
          [user.id, room.id, room.monthly_rent, room.security_deposit || 0, startDate || new Date().toISOString().slice(0, 10)]
        );
        lease = leaseResult.rows[0];
        // NOTE: room occupancy + status are updated by the lease_occupancy and room_status DB triggers.
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    return res.status(201).json({
      success: true,
      message: lease ? "Tenant created and assigned to room" : "Tenant account created",
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        createdAt: user.created_at,
        roomId: lease ? lease.room_id : null,
        leaseId: lease ? lease.id : null,
      },
    });
  } catch (error) {
    console.error("Create tenant error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Does this tenant user belong to this owner (has any lease in the owner's properties)?
function tenantOwnedBy(sqlAlias, uidIdx, tenantIdIdx) {
  return `EXISTS (
    SELECT 1 FROM leases tl
    JOIN rooms tr ON tl.room_id = tr.id
    JOIN properties tp ON tr.property_id = tp.id
    WHERE tl.tenant_id = ${sqlAlias}.id AND tp.owner_id = $${uidIdx}
  )`;
}

// A tenant's personal information (name, email, phone) belongs to the tenant.
// Owners can only change the account status (below) and manage leases; the
// tenant edits their own details from their profile screen.
router.put("/tenants/:id", (req, res) => {
  return res.status(403).json({
    success: false,
    message: "Owners cannot edit a tenant's personal information. Only the tenant can update their own profile.",
  });
});

router.patch("/tenants/:id/status", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !["active", "inactive", "suspended"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid account status" });
    }

    const ownerCheck = await pool.query(
      `SELECT u.id FROM users u
       WHERE u.id = $2 AND u.role = 'tenant' AND ${tenantOwnedBy("u", 1, 2)}`,
      [uid, id]
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Tenant not found" });
    }

    const result = await pool.query(
      `UPDATE users
       SET status = $1, updated_at = NOW()
       WHERE id = $2 AND role = 'tenant'
       RETURNING id, status`,
      [status, id]
    );

    return res.json({
      success: true,
      message: "Tenant status updated",
      data: { id: result.rows[0].id, accountStatus: result.rows[0].status },
    });
  } catch (error) {
    console.error("Update tenant status error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Assign an existing tenant to a room by creating a lease.
router.post("/leases", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { tenantId, roomId, startDate, monthlyRent, securityDeposit } = req.body;

    if (!tenantId || !roomId) {
      return res.status(400).json({ success: false, message: "Tenant and room are required" });
    }

    const roomResult = await pool.query(
      `SELECT r.id, r.room_number, r.monthly_rent, r.security_deposit, r.status, r.capacity, r.current_occupancy,
              p.name AS property_name
       FROM rooms r
       JOIN properties p ON p.id = r.property_id
       WHERE r.id = $2 AND ${propertyOwnerWhereIdx("r", 1)}`,
      [uid, roomId]
    );
    if (roomResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }
    const room = roomResult.rows[0];
    if (room.status === "inactive" || room.status === "maintenance") {
      return res.status(409).json({ success: false, message: "Room is not available" });
    }
    if (room.current_occupancy >= room.capacity) {
      return res.status(409).json({ success: false, message: "Room is at full capacity" });
    }

    const tenantCheck = await pool.query(
      `SELECT u.id, u.name FROM users u
       WHERE u.id = $1 AND u.role = 'tenant'`,
      [tenantId]
    );
    if (tenantCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Tenant not found" });
    }

    const activeLease = await pool.query(
      `SELECT id FROM leases
       WHERE tenant_id = $1 AND status = 'active'
       LIMIT 1`,
      [tenantId]
    );
    if (activeLease.rows.length > 0) {
      return res.status(409).json({ success: false, message: "Tenant already has an active lease" });
    }

    // The lease and the tenant's notification are committed together.
    const client = await pool.connect();
    let lease;
    try {
      await client.query("BEGIN");

      const result = await client.query(
        `INSERT INTO leases (tenant_id, room_id, monthly_rent, security_deposit, status, start_date)
         VALUES ($1, $2, $3, $4, 'active', $5)
         RETURNING id, tenant_id, room_id, start_date, monthly_rent, status`,
        [
          tenantId,
          roomId,
          monthlyRent != null ? monthlyRent : room.monthly_rent,
          securityDeposit != null ? securityDeposit : room.security_deposit || 0,
          startDate || new Date().toISOString().slice(0, 10),
        ]
      );
      lease = result.rows[0];
      await cancelOtherPendingApplications(client, lease.tenant_id, lease.id);

      await notifyLeaseAssigned(client, {
        tenantId: lease.tenant_id,
        roomNumber: room.room_number,
        propertyName: room.property_name,
        leaseId: lease.id,
      });

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    // NOTE: room occupancy + status are updated by the lease_occupancy and room_status DB triggers.

    return res.status(201).json({
      success: true,
      message: `Assigned ${tenantCheck.rows[0].name} to room ${room.room_number}`,
      data: {
        id: lease.id,
        tenantId: lease.tenant_id,
        roomId: lease.room_id,
        startDate: lease.start_date,
        monthlyRent: lease.monthly_rent,
        status: lease.status,
        roomNumber: room.room_number,
      },
    });
  } catch (error) {
    console.error("Create lease error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── Payments ────────────────────────────────────────────
router.get("/payments", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { status, period } = req.query;

    let query = `
      SELECT p.id, p.amount, p.status, p.payment_date, p.payment_method,
             p.reference_number, p.proof_url, p.receipt_url, p.rejection_reason, p.notes, p.created_at,
             p.billing_period_start, p.billing_period_end, p.verified_by, p.verified_at,
             u.id AS tenant_id, u.name AS tenant_name, u.email AS tenant_email,
             r.id AS room_id, r.room_number,
             prop.id AS property_id, prop.name AS property_name,
             l.id AS lease_id
       FROM payments p
       JOIN leases l ON p.lease_id = l.id
       JOIN users u ON l.tenant_id = u.id
       JOIN rooms r ON l.room_id = r.id
       JOIN properties prop ON r.property_id = prop.id
       WHERE ${propertyOwnerWhereIdx("r", 1)}
    `;
    const params = [uid];
    let idx = 2;

    if (status && status !== "all") {
      query += ` AND p.status = $${idx}`;
      params.push(status);
      idx++;
    }
    if (period) {
      query += ` AND p.payment_date <= $${idx}`;
      params.push(period);
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
        proofUrl: r.proof_url,
        receiptUrl: r.receipt_url,
        rejectionReason: r.rejection_reason,
        notes: r.notes,
        createdAt: r.created_at,
        billingPeriodStart: r.billing_period_start,
        billingPeriodEnd: r.billing_period_end,
        verifiedBy: r.verified_by,
        verifiedAt: r.verified_at,
        tenantId: r.tenant_id,
        tenantName: r.tenant_name,
        tenantEmail: r.tenant_email,
        roomId: r.room_id,
        roomNumber: r.room_number,
        propertyId: r.property_id,
        propertyName: r.property_name,
        leaseId: r.lease_id,
      })),
    });
  } catch (error) {
    console.error("Get payments error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Single payment detail. The payment must belong to a lease in one of the
// owner's own properties; otherwise it is hidden (404).
router.get("/payments/:id", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      `SELECT p.id, p.amount, p.status, p.payment_date, p.payment_method,
              p.reference_number, p.proof_url, p.receipt_url, p.rejection_reason, p.notes,
              p.billing_period_start, p.billing_period_end, p.created_at, p.updated_at,
              p.verified_by, p.verified_at,
              u.id AS tenant_id, u.name AS tenant_name, u.email AS tenant_email, u.phone AS tenant_phone,
              r.id AS room_id, r.room_number, r.floor,
              prop.id AS property_id, prop.name AS property_name, prop.address AS property_address,
              l.id AS lease_id, l.start_date AS lease_start, l.end_date AS lease_end,
              l.monthly_rent AS lease_rent, l.status AS lease_status,
              pb.name AS verified_by_name
       FROM payments p
       JOIN leases l ON p.lease_id = l.id
       JOIN users u ON l.tenant_id = u.id
       JOIN rooms r ON l.room_id = r.id
       JOIN properties prop ON r.property_id = prop.id
       LEFT JOIN users pb ON pb.id = p.verified_by
       WHERE p.id = $2 AND ${propertyOwnerWhereIdx("r", 1)}
       LIMIT 1`,
      [uid, id]
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
        proofUrl: p.proof_url,
        receiptUrl: p.receipt_url,
        rejectionReason: p.rejection_reason,
        notes: p.notes,
        billingPeriodStart: p.billing_period_start,
        billingPeriodEnd: p.billing_period_end,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        verifiedBy: p.verified_by,
        verifiedAt: p.verified_at,
        verifiedByName: p.verified_by_name,
        tenantId: p.tenant_id,
        tenantName: p.tenant_name,
        tenantEmail: p.tenant_email,
        tenantPhone: p.tenant_phone,
        roomId: p.room_id,
        roomNumber: p.room_number,
        floor: p.floor,
        propertyId: p.property_id,
        propertyName: p.property_name,
        propertyAddress: p.property_address,
        leaseId: p.lease_id,
        leaseStart: p.lease_start,
        leaseEnd: p.lease_end,
        leaseRent: p.lease_rent,
        leaseStatus: p.lease_status,
      },
    });
  } catch (error) {
    console.error("Get payment error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Shared transaction that verifies a payment can be processed:
//  - the payment exists and belongs to one of the owner's properties,
//  - the payment belongs to a lease under that property,
//  - the payment is still pending,
//  - the amount is valid (> 0).
async function processPayment(uid, paymentId, nextStatus, rejectionReason) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const payResult = await client.query(
      `SELECT p.id, p.lease_id, p.amount, p.status AS current_status,
              p.tenant_id, r.room_number, prop.name AS property_name
       FROM payments p
       JOIN leases l ON p.lease_id = l.id
       JOIN rooms r ON l.room_id = r.id
       JOIN properties prop ON r.property_id = prop.id
       WHERE p.id = $2 AND prop.owner_id = $1
       FOR UPDATE OF p
       LIMIT 1`,
      [uid, paymentId]
    );

    if (payResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, status: 404, message: "Payment not found" };
    }

    const pay = payResult.rows[0];
    if (!pay.lease_id) {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, message: "Payment does not belong to a valid lease" };
    }
    if (pay.current_status !== "pending") {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, message: "Only pending payments can be verified or rejected" };
    }
    if (Number(pay.amount) <= 0) {
      await client.query("ROLLBACK");
      return { ok: false, status: 400, message: "Payment amount is invalid" };
    }

    await client.query(
      `UPDATE payments
       SET status = $1::payment_status,
           rejection_reason = $2,
           verified_by = $3,
           verified_at = NOW(),
           updated_at = NOW()
       WHERE id = $4`,
      [nextStatus, nextStatus === "rejected" ? rejectionReason || null : null, uid, paymentId]
    );

    // The status flip and the tenant's notification share this transaction.
    const context = {
      tenantId: pay.tenant_id,
      amount: pay.amount,
      roomNumber: pay.room_number,
      propertyName: pay.property_name,
      paymentId,
    };
    if (nextStatus === "rejected") {
      await notifyPaymentRejected(client, { ...context, reason: rejectionReason || null });
    } else {
      await notifyPaymentVerified(client, context);
    }

    await client.query("COMMIT");
    return { ok: true, data: { id: paymentId, status: nextStatus } };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

router.patch("/payments/:id/verify", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;

    const result = await processPayment(uid, id, "paid", null);

    if (!result.ok) {
      return res.status(result.status).json({ success: false, message: result.message });
    }

    return res.json({
      success: true,
      message: "Payment verified",
      data: result.data,
    });
  } catch (error) {
    console.error("Verify payment error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.patch("/payments/:id/reject", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;
    const { reason } = req.body;

    const result = await processPayment(uid, id, "rejected", reason);

    if (!result.ok) {
      return res.status(result.status).json({ success: false, message: result.message });
    }

    return res.json({
      success: true,
      message: "Payment rejected",
      data: result.data,
    });
  } catch (error) {
    console.error("Reject payment error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── Reservations (lease requests) ───────────────────────
router.get("/reservations", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { status } = req.query;

    let query = `
      SELECT l.id, l.requested_at, l.status /* lease_status */ AS lease_status, l.notes, l.created_at,
             u.id AS tenant_id, u.name AS tenant_name, u.email AS tenant_email, u.phone AS tenant_phone,
             r.id AS room_id, r.room_number,
             p.name AS property_name,
             l.start_date, l.end_date, l.monthly_rent
       FROM leases l
       JOIN users u ON l.tenant_id = u.id
       JOIN rooms r ON l.room_id = r.id
       JOIN properties p ON r.property_id = p.id
       WHERE p.owner_id = $1
    `;
    const params = [uid];
    let idx = 2;

    if (status && status !== "all") {
      query += ` AND l.status = $${idx}`;
      params.push(status);
      idx++;
    } else {
      query += ` AND l.status IN ('pending_approval', 'active', 'rejected', 'cancelled', 'terminated')`;
    }

    query += HIDE_STALE_PENDING;

    query += ` ORDER BY l.created_at DESC`;

    const result = await pool.query(query, params);

    return res.json({
      success: true,
      data: result.rows.map((r) => ({
        id: r.id,
        requestedDate: r.requested_at,
        status: r.lease_status,
        notes: r.notes,
        createdAt: r.created_at,
        tenantId: r.tenant_id,
        tenantName: r.tenant_name,
        tenantEmail: r.tenant_email,
        tenantPhone: r.tenant_phone,
        roomId: r.room_id,
        roomNumber: r.room_number,
        propertyName: r.property_name,
        startDate: r.start_date,
        endDate: r.end_date,
        monthlyRent: r.monthly_rent,
      })),
    });
  } catch (error) {
    console.error("Get reservations error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Single reservation detail; the reservation must belong to a room in the owner's property.
router.get("/reservations/:id", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      `SELECT l.id, l.requested_at, l.status AS lease_status, l.notes, l.created_at,
              l.start_date, l.end_date, l.monthly_rent, l.security_deposit, l.rejection_reason,
              u.id AS tenant_id, u.name AS tenant_name, u.email AS tenant_email, u.phone AS tenant_phone,
              r.id AS room_id, r.room_number, r.floor, r.description, r.capacity, r.current_occupancy,
              r.amenities, r.status AS room_status,
              p.id AS property_id, p.name AS property_name, p.address AS property_address,
              p.contact_number AS property_contact
       FROM leases l
       JOIN users u ON l.tenant_id = u.id
       JOIN rooms r ON l.room_id = r.id
       JOIN properties p ON r.property_id = p.id
       WHERE l.id = $2 AND p.owner_id = $1
       LIMIT 1`,
      [uid, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Reservation not found." });
    }

    const r = result.rows[0];
    return res.json({
      success: true,
      data: {
        id: r.id,
        requestedDate: r.requested_at,
        status: r.lease_status,
        notes: r.notes,
        createdAt: r.created_at,
        startDate: r.start_date,
        endDate: r.end_date,
        monthlyRent: Number(r.monthly_rent),
        securityDeposit: Number(r.security_deposit || 0),
        rejectionReason: r.rejection_reason,
        tenantId: r.tenant_id,
        tenantName: r.tenant_name,
        tenantEmail: r.tenant_email,
        tenantPhone: r.tenant_phone,
        roomId: r.room_id,
        roomNumber: r.room_number,
        floor: r.floor,
        roomType: r.floor || null,
        roomDescription: r.description,
        roomCapacity: r.capacity,
        currentOccupancy: r.current_occupancy,
        amenities: r.amenities || [],
        roomStatus: r.room_status,
        propertyId: r.property_id,
        propertyName: r.property_name,
        propertyAddress: r.property_address,
        propertyContact: r.property_contact,
      },
    });
  } catch (error) {
    console.error("Get reservation error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── Approval / rejection helpers ─────────────────────────
// Both operations run inside a PostgreSQL transaction.
//  - The reservation row is locked (FOR UPDATE) while we verify ownership + status.
//  - The room row is locked while we re-check availability so two approvals can
//    never over-consume the last free slot.
//  - Occupancy is left to the lease_occupancy / room_status triggers.

async function approveReservation(uid, reservationId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const leaseResult = await client.query(
      `SELECT l.id, l.tenant_id, l.room_id, l.status AS lease_status,
              r.capacity, r.current_occupancy, r.room_number,
              p.name AS property_name
       FROM leases l
       JOIN rooms r ON r.id = l.room_id
       JOIN properties p ON p.id = r.property_id
       WHERE l.id = $2 AND p.owner_id = $1
       FOR UPDATE OF l
       LIMIT 1`,
      [uid, reservationId]
    );

    if (leaseResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, status: 404, message: "Reservation not found." };
    }

    const lease = leaseResult.rows[0];

    if (lease.lease_status !== "pending_approval") {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, message: "Reservation has already been processed." };
    }

    const roomResult = await client.query(
      `SELECT r.id, r.status, r.capacity, r.current_occupancy
       FROM rooms r
       WHERE r.id = $1
       FOR UPDATE`,
      [lease.room_id]
    );

    if (roomResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, status: 404, message: "Room is no longer available." };
    }

    const room = roomResult.rows[0];

    if (room.status === "maintenance" || room.status === "inactive") {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, message: "Room is no longer available." };
    }

    if (room.status === "occupied" || room.current_occupancy >= room.capacity) {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, message: "This room is already at full capacity." };
    }

    const tenantActive = await client.query(
      `SELECT id FROM leases
       WHERE tenant_id = $1 AND id <> $2 AND status = 'active'
       LIMIT 1
       FOR UPDATE`,
      [lease.tenant_id, lease.id]
    );

    if (tenantActive.rows.length > 0) {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, message: "Tenant already has an active lease." };
    }

    await client.query(
      `UPDATE leases
       SET status = 'active', approved_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [reservationId]
    );

    await cancelOtherPendingApplications(client, lease.tenant_id, reservationId);

    // If approving this lease filled the room, cancel the other pending
    // reservations for the same room so no one is left waiting on a full room.
    const occResult = await client.query(
      `SELECT COUNT(*)::int AS occ
       FROM leases
       WHERE room_id = $1 AND status = 'active'`,
      [lease.room_id]
    );

    if (occResult.rows.length > 0 && occResult.rows[0].occ >= room.capacity) {
      await client.query(
        `UPDATE leases
         SET status = 'cancelled',
             rejection_reason = 'Another reservation was approved and the room is now full.',
             updated_at = NOW()
         WHERE room_id = $1 AND id <> $2 AND status = 'pending_approval'`,
        [lease.room_id, reservationId]
      );
    }

    // The status flip and the tenant's notification share this transaction.
    await notifyReservationApproved(client, {
      tenantId: lease.tenant_id,
      roomNumber: lease.room_number,
      propertyName: lease.property_name,
      reservationId,
    });

    await client.query("COMMIT");
    return { ok: true, data: { id: lease.id, status: "active", roomId: lease.room_id } };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error && error.code === "23505") {
      const tenantClash = String(error.constraint || "").includes("tenant");
      return {
        ok: false,
        status: 409,
        message: tenantClash
          ? "Tenant already has an active lease."
          : "This room is already at full capacity.",
      };
    }
    throw error;
  } finally {
    client.release();
  }
}

async function rejectReservation(uid, reservationId, reason) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const leaseResult = await client.query(
      `SELECT l.id, l.tenant_id, l.status AS lease_status,
              r.room_number, p.name AS property_name
       FROM leases l
       JOIN rooms r ON r.id = l.room_id
       JOIN properties p ON p.id = r.property_id
       WHERE l.id = $2 AND p.owner_id = $1
       FOR UPDATE OF l
       LIMIT 1`,
      [uid, reservationId]
    );

    if (leaseResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, status: 404, message: "Reservation not found." };
    }

    if (leaseResult.rows[0].lease_status !== "pending_approval") {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, message: "Reservation has already been processed." };
    }

    // Rejecting only flips the status; room occupancy is not touched.
    await client.query(
      `UPDATE leases
       SET status = 'rejected',
           rejection_reason = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [reservationId, reason || null]
    );

    // The status flip and the tenant's notification share this transaction.
    const rejected = leaseResult.rows[0];
    await notifyReservationRejected(client, {
      tenantId: rejected.tenant_id,
      roomNumber: rejected.room_number,
      propertyName: rejected.property_name,
      reservationId,
      reason: reason || null,
    });

    await client.query("COMMIT");
    return { ok: true, data: { id: leaseResult.rows[0].id, status: "rejected" } };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

router.post("/reservations/:id/approve", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;

    const result = await approveReservation(uid, id);

    if (!result.ok) {
      return res.status(result.status).json({ success: false, message: result.message });
    }

    return res.json({
      success: true,
      message: "Reservation approved. The tenant now has an active lease.",
      data: result.data,
    });
  } catch (error) {
    console.error("Approve reservation error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post("/reservations/:id/reject", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;
    const { reason } = req.body;

    const result = await rejectReservation(uid, id, reason);

    if (!result.ok) {
      return res.status(result.status).json({ success: false, message: result.message });
    }

    return res.json({
      success: true,
      message: "Reservation rejected.",
      data: result.data,
    });
  } catch (error) {
    console.error("Reject reservation error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Backward-compatible PATCH used by earlier clients.
router.patch("/reservations/:id", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;
    const { status, rejectionReason } = req.body;

    if (!status || !["approved", "rejected"].includes(status)) {
      return res.status(400).json({ success: false, message: "Status must be 'approved' or 'rejected'" });
    }

    const result =
      status === "approved"
        ? await approveReservation(uid, id)
        : await rejectReservation(uid, id, rejectionReason);

    if (!result.ok) {
      return res.status(result.status).json({ success: false, message: result.message });
    }

    return res.json({
      success: true,
      message: status === "approved" ? "Reservation approved" : "Reservation rejected",
      data: result.data,
    });
  } catch (error) {
    console.error("Update reservation error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── Maintenance ─────────────────────────────────────────
router.get("/maintenance", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { status, priority } = req.query;

    let query = `
      SELECT m.id, m.title, m.description, m.category, m.priority, m.status, m.created_at, m.updated_at,
             m.image_url, m.owner_notes, m.completed_at,
             u.id AS tenant_id, u.name AS tenant_name, u.email AS tenant_email, u.phone AS tenant_phone,
             r.id AS room_id, r.room_number,
             p.id AS property_id, p.name AS property_name
       FROM maintenance_requests m
       JOIN users u ON m.tenant_id = u.id
       JOIN rooms r ON m.room_id = r.id
       JOIN properties p ON r.property_id = p.id
       WHERE ${propertyOwnerWhereIdx("r", 1)}
    `;
    const params = [uid];
    let idx = 2;

    if (status && status !== "all") {
      query += ` AND m.status = $${idx}`;
      params.push(status);
      idx++;
    }
    if (priority && priority !== "all") {
      query += ` AND m.priority = $${idx}`;
      params.push(priority);
      idx++;
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
        imageUrl: r.image_url,
        ownerNotes: r.owner_notes,
        completedAt: r.completed_at,
        tenantId: r.tenant_id,
        tenantName: r.tenant_name,
        tenantEmail: r.tenant_email,
        tenantPhone: r.tenant_phone,
        roomId: r.room_id,
        roomNumber: r.room_number,
        propertyId: r.property_id,
        propertyName: r.property_name,
      })),
    });
  } catch (error) {
    console.error("Get maintenance error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Single maintenance request detail. The request must belong to a room in one
// of the owner's own properties; otherwise it is hidden (404).
router.get("/maintenance/:id", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      `SELECT m.id, m.title, m.description, m.category, m.priority, m.status, m.created_at, m.updated_at,
              m.image_url, m.owner_notes, m.completed_at,
              u.id AS tenant_id, u.name AS tenant_name, u.email AS tenant_email, u.phone AS tenant_phone,
              r.id AS room_id, r.room_number, r.floor,
              p.id AS property_id, p.name AS property_name, p.address AS property_address,
              p.contact_number AS property_contact
       FROM maintenance_requests m
       JOIN users u ON m.tenant_id = u.id
       JOIN rooms r ON m.room_id = r.id
       JOIN properties p ON r.property_id = p.id
       WHERE m.id = $2 AND ${propertyOwnerWhereIdx("r", 1)}
       LIMIT 1`,
      [uid, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Maintenance request not found" });
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
        imageUrl: m.image_url,
        ownerNotes: m.owner_notes,
        completedAt: m.completed_at,
        tenantId: m.tenant_id,
        tenantName: m.tenant_name,
        tenantEmail: m.tenant_email,
        tenantPhone: m.tenant_phone,
        roomId: m.room_id,
        roomNumber: m.room_number,
        floor: m.floor,
        propertyId: m.property_id,
        propertyName: m.property_name,
        propertyAddress: m.property_address,
        propertyContact: m.property_contact,
      },
    });
  } catch (error) {
    console.error("Get maintenance detail error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Owner updates a request status. Only valid next steps in the workflow are
// allowed; anything else is rejected with 409 (or 400 for unknown statuses).
router.patch("/maintenance/:id/status", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;
    const { status } = req.body;

    if (!MAINTENANCE_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const result = await pool.query(
      `SELECT m.id, m.tenant_id, m.title, m.status AS current_status
       FROM maintenance_requests m
       JOIN rooms r ON m.room_id = r.id
       WHERE m.id = $2 AND ${propertyOwnerWhereIdx("r", 1)}
       LIMIT 1`,
      [uid, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Maintenance request not found" });
    }

    const current = result.rows[0].current_status;
    if (current === status) {
      return res.status(200).json({ success: true, message: "Status unchanged", data: { id, status } });
    }
    if (!MAINTENANCE_TRANSITIONS[current]?.includes(status)) {
      return res.status(409).json({
        success: false,
        message: `Cannot move a ${current} request to ${status}`,
      });
    }

    // The status change and the tenant's notification share this transaction.
    const client = await pool.connect();
    let update;
    try {
      await client.query("BEGIN");

      const updated = await client.query(
        `UPDATE maintenance_requests
         SET status = $2::maintenance_status,
             completed_at = CASE WHEN $2::text = 'completed' THEN NOW() ELSE NULL END,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, status, updated_at`,
        [id, status]
      );
      update = updated.rows[0];

      await notifyMaintenanceUpdated(client, {
        tenantId: result.rows[0].tenant_id,
        title: result.rows[0].title,
        status: update.status,
        maintenanceId: update.id,
      });

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    return res.json({
      success: true,
      message: "Status updated",
      data: { id: update.id, status: update.status },
    });
  } catch (error) {
    console.error("Update maintenance status error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Owner adds or updates internal/public notes on a request of their own property.
router.patch("/maintenance/:id/notes", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;
    const { ownerNotes } = req.body;

    if (ownerNotes !== undefined && ownerNotes !== null && typeof ownerNotes !== "string") {
      return res.status(400).json({ success: false, message: "Notes must be text" });
    }
    if (ownerNotes && ownerNotes.length > 2000) {
      return res.status(400).json({ success: false, message: "Notes are too long" });
    }

    const result = await pool.query(
      `UPDATE maintenance_requests m
       SET owner_notes = $2::text,
           updated_at = NOW()
       FROM rooms r
       WHERE m.id = $1 AND m.room_id = r.id AND ${propertyOwnerWhereIdx("r", 3)}
       RETURNING m.id, m.owner_notes`,
      [id, ownerNotes || null, uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Maintenance request not found" });
    }

    return res.json({
      success: true,
      message: "Notes updated",
      data: { id: result.rows[0].id, ownerNotes: result.rows[0].owner_notes },
    });
  } catch (error) {
    console.error("Update maintenance notes error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── Announcements ───────────────────────────────────────
const ANNOUNCEMENT_STATUSES = ["draft", "published", "archived"];

// Resolve the property an announcement is attached to. A propertyId supplied by
// the client is only honored when it is genuinely owned by req.user.userId; it
// is never trusted on its own. When omitted, the owner's first property is used
// so that announcements always belong to one of the owner's own properties.
async function resolveOwnerProperty(uid, propertyId) {
  if (propertyId) {
    const prop = await pool.query(
      `SELECT id FROM properties WHERE id = $1 AND owner_id = $2`,
      [propertyId, uid]
    );
    if (prop.rows.length) return prop.rows[0].id;
    return false; // property exists but is not owned by this owner
  }
  const first = await pool.query(
    `SELECT id FROM properties WHERE owner_id = $1 ORDER BY created_at LIMIT 1`,
    [uid]
  );
  return first.rows.length ? first.rows[0].id : null; // null = no property yet
}

const ANNOUNCEMENT_SELECT = `
  SELECT a.id, a.title, a.content, a.status, a.published_at, a.created_at, a.updated_at,
         a.property_id, p.name AS property_name
  FROM announcements a
  LEFT JOIN properties p ON p.id = a.property_id`;

function mapAnnouncement(a) {
  return {
    id: a.id,
    title: a.title,
    content: a.content,
    status: a.status,
    publishedAt: a.published_at,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
    propertyId: a.property_id,
    propertyName: a.property_name,
  };
}

// List all announcements across the owner's properties (draft, published, archived).
router.get("/announcements", async (req, res) => {
  try {
    const uid = req.user.userId;
    const result = await pool.query(
      `${ANNOUNCEMENT_SELECT}
       WHERE a.owner_id = $1
       ORDER BY a.created_at DESC`,
      [uid]
    );

    return res.json({
      success: true,
      data: result.rows.map(mapAnnouncement),
    });
  } catch (error) {
    console.error("Get announcements error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Single announcement owned by the authenticated owner; hidden otherwise (404).
router.get("/announcements/:id", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      `${ANNOUNCEMENT_SELECT}
       WHERE a.id = $1 AND a.owner_id = $2`,
      [id, uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Announcement not found" });
    }

    return res.json({ success: true, data: mapAnnouncement(result.rows[0]) });
  } catch (error) {
    console.error("Get announcement detail error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Create an announcement as a draft on one of the owner's own properties.
router.post("/announcements", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { title, content, propertyId } = req.body;

    if (typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ success: false, message: "Title is required" });
    }
    if (typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ success: false, message: "Content is required" });
    }
    if (title.trim().length > 200) {
      return res.status(400).json({ success: false, message: "Title is too long" });
    }

    const property = await resolveOwnerProperty(uid, propertyId);
    if (property === false) {
      return res.status(403).json({ success: false, message: "You can only post announcements to your own property" });
    }
    if (property === null) {
      return res.status(400).json({ success: false, message: "Create a property before posting announcements" });
    }

    const result = await pool.query(
      `INSERT INTO announcements (owner_id, property_id, title, content, status)
       VALUES ($1, $2, $3, $4, 'draft')
       RETURNING id, title, content, status, published_at, created_at, updated_at, property_id`,
      [uid, property, title.trim(), content.trim()]
    );

    const a = result.rows[0];
    return res.status(201).json({
      success: true,
      message: "Announcement created",
      data: {
        id: a.id,
        title: a.title,
        content: a.content,
        status: a.status,
        publishedAt: a.published_at,
        createdAt: a.created_at,
        updatedAt: a.updated_at,
        propertyId: a.property_id,
      },
    });
  } catch (error) {
    console.error("Create announcement error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Edit the title/content of an own announcement. owner_id and property_id are
// never read from the body; ownership is always taken from req.user.userId and
// the announcement cannot be moved to another owner's property.
router.put("/announcements/:id", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;
    const { title, content } = req.body;

    if (typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ success: false, message: "Title is required" });
    }
    if (typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ success: false, message: "Content is required" });
    }
    if (title.trim().length > 200) {
      return res.status(400).json({ success: false, message: "Title is too long" });
    }

    const result = await pool.query(
      `UPDATE announcements
       SET title = $1,
           content = $2,
           updated_at = NOW()
       WHERE id = $3 AND owner_id = $4
       RETURNING id, title, content, status, published_at, created_at, updated_at, property_id`,
      [title.trim(), content.trim(), id, uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Announcement not found" });
    }

    const a = result.rows[0];
    return res.json({
      success: true,
      message: "Announcement updated",
      data: {
        id: a.id,
        title: a.title,
        content: a.content,
        status: a.status,
        publishedAt: a.published_at,
        createdAt: a.created_at,
        updatedAt: a.updated_at,
        propertyId: a.property_id,
      },
    });
  } catch (error) {
    console.error("Update announcement error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Publish an announcement of the owner's property. Drafts and re-published
// archived announcements are allowed; published_at is set on first publish.
router.patch("/announcements/:id/publish", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;

    const current = await pool.query(
      `SELECT id, title, status, property_id FROM announcements WHERE id = $1 AND owner_id = $2`,
      [id, uid]
    );
    if (current.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Announcement not found" });
    }

    const cur = current.rows[0].status;
    if (cur === "published") {
      return res.json({ success: true, message: "Announcement already published", data: { id, status: cur } });
    }
    if (!["draft", "archived"].includes(cur)) {
      return res.status(409).json({ success: false, message: `Cannot publish a ${cur} announcement` });
    }

    // Publishing and the fan-out to that property's tenants share this
    // transaction, so a tenant is never told about an unpublished announcement.
    const client = await pool.connect();
    let a;
    try {
      await client.query("BEGIN");

      const result = await client.query(
        `UPDATE announcements
         SET status = 'published',
             published_at = COALESCE(published_at, NOW()),
             updated_at = NOW()
         WHERE id = $1 AND owner_id = $2
         RETURNING id, status, published_at, updated_at`,
        [id, uid]
      );
      a = result.rows[0];

      if (current.rows[0].property_id) {
        const property = await client.query(
          `SELECT name FROM properties WHERE id = $1`,
          [current.rows[0].property_id]
        );
        await notifyAnnouncementPublished(client, {
          announcementId: a.id,
          title: current.rows[0].title,
          propertyId: current.rows[0].property_id,
          propertyName: property.rows[0]?.name || "your dormitory",
        });
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    return res.json({
      success: true,
      message: "Announcement published",
      data: { id: a.id, status: a.status, publishedAt: a.published_at, updatedAt: a.updated_at },
    });
  } catch (error) {
    console.error("Publish announcement error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Archive an announcement so it no longer appears in the tenant feed.
// Physical deletion is never used for archiving.
router.patch("/announcements/:id/archive", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;

    const current = await pool.query(
      `SELECT id, status FROM announcements WHERE id = $1 AND owner_id = $2`,
      [id, uid]
    );
    if (current.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Announcement not found" });
    }

    const cur = current.rows[0].status;
    if (cur === "archived") {
      return res.json({ success: true, message: "Announcement already archived", data: { id, status: cur } });
    }
    if (!["draft", "published"].includes(cur)) {
      return res.status(409).json({ success: false, message: `Cannot archive a ${cur} announcement` });
    }

    const result = await pool.query(
      `UPDATE announcements
       SET status = 'archived',
           updated_at = NOW()
       WHERE id = $1 AND owner_id = $2
       RETURNING id, status, updated_at`,
      [id, uid]
    );

    const a = result.rows[0];
    return res.json({
      success: true,
      message: "Announcement archived",
      data: { id: a.id, status: a.status, updatedAt: a.updated_at },
    });
  } catch (error) {
    console.error("Archive announcement error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Delete an announcement. Only the owning owner can delete; tenants never can.
router.delete("/announcements/:id", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM announcements WHERE id = $1 AND owner_id = $2 RETURNING id`,
      [id, uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Announcement not found" });
    }

    return res.json({
      success: true,
      message: "Announcement deleted",
      data: { id: result.rows[0].id },
    });
  } catch (error) {
    console.error("Delete announcement error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── Messages ────────────────────────────────────────────
// Messaging lives under /api/messages (backend/routes/messages.js) so owners
// and tenants share one secure, relationship-checked implementation.

// ─── Property Photos ─────────────────────────────────────
const fs = require("fs");
const path = require("path");
const upload = require("../middleware/propertyPhotoUpload");

// Helper: verify property exists AND is owned by this owner.
// Owner-scoped on purpose — a property owned by someone else matches no rows,
// exactly like a missing one, so both answer 404 and existence is never
// confirmed to a non-owner. (Shared by the property photos endpoints.)
async function assertOwnerProperty(uid, propertyId) {
  const result = await pool.query(
    `SELECT id FROM properties WHERE id = $1 AND owner_id = $2`,
    [propertyId, uid]
  );
  if (result.rows.length === 0) return { ok: false, status: 404, message: "Property not found" };
  return { ok: true };
}

// Helper: verify a photo row belongs to a property owned by this owner.
async function assertOwnerPhoto(uid, propertyId, photoId) {
  const propCheck = await assertOwnerProperty(uid, propertyId);
  if (!propCheck.ok) return propCheck;
  const photoResult = await pool.query(
    `SELECT id FROM property_photos WHERE id = $1 AND property_id = $2`,
    [photoId, propertyId]
  );
  if (photoResult.rows.length === 0) return { ok: false, status: 404, message: "Photo not found" };
  return { ok: true };
}

// List property photos
router.get("/properties/:id/photos", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;

    const propCheck = await assertOwnerProperty(uid, id);
    if (!propCheck.ok) {
      return res.status(propCheck.status).json({ success: false, message: propCheck.message });
    }

    const result = await pool.query(
      `SELECT id, photo_url, is_primary, created_at
       FROM property_photos
       WHERE property_id = $1
       ORDER BY is_primary DESC, created_at ASC`,
      [id]
    );

    return res.json({
      success: true,
      data: result.rows.map((r) => ({
        id: r.id,
        photoUrl: toPublicPhotoUrl(req, r.photo_url),
        isPrimary: r.is_primary,
        createdAt: r.created_at,
      })),
    });
  } catch (error) {
    console.error("Get property photos error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Upload a property photo. multer runs first; any validation error (e.g.
// unsupported MIME type or oversized file) is converted to a JSON 400 so the
// app can surface it instead of the default HTML error page.
router.post(
  "/properties/:id/photos",
  (req, res, next) => {
    console.log("PHOTO UPLOAD REQUEST — pre-multer");
    console.log("  method:", req.method, "url:", req.originalUrl);
    console.log("  params:", req.params);
    console.log("  user:", req.user);
    console.log("  UPLOAD CONTENT TYPE:", req.headers["content-type"]);
    console.log("  content-length:", req.get("Content-Length"));

    upload.single("photo")(req, res, (err) => {
      if (err) {
        console.error("  multer error:", err.code, err.message);
        return res.status(400).json({ success: false, message: err.message || "Upload failed" });
      }
      next();
    });
  },
  async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;

    console.log("PHOTO UPLOAD — post-multer");
    console.log("  UPLOAD BODY:", req.body);
    console.log("  UPLOAD FILE:", req.file ? {
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      encoding: req.file.encoding,
      mimetype: req.file.mimetype,
      size: req.file.size,
      path: req.file.path,
    } : undefined);

    if (!req.file || !req.file.size) {
      if (req.file) {
        try { fs.unlinkSync(req.file.path); } catch {}
      }
      const receivedAsText = req.body && typeof req.body.photo === "string";
      console.warn("  no usable file part", receivedAsText ? "(photo arrived as text, not a file)" : "");
      return res.status(400).json({
        success: false,
        message: "No photo file was received",
      });
    }

    const propCheck = await assertOwnerProperty(uid, id);
    if (!propCheck.ok) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(propCheck.status).json({ success: false, message: propCheck.message });
    }

    // HEIC/HEIF (iPhone photos) are converted to JPEG before storage so every
    // client can display them. Other formats pass through unchanged.
    let finalFilename;
    try {
      finalFilename = await upload.normalizePropertyPhoto(req.file);
    } catch (conversionError) {
      console.error("Property photo conversion error:", conversionError);
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({
        success: false,
        message: conversionError instanceof Error ? conversionError.message : "Unsupported image format",
      });
    }

    const storedPath = toStoredPhotoPath(finalFilename);
    const photoUrl = toPublicPhotoUrl(req, storedPath);

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM property_photos WHERE property_id = $1`,
      [id]
    );
    const isFirst = countResult.rows[0].cnt === 0;

    const result = await pool.query(
      `INSERT INTO property_photos (property_id, photo_url, is_primary)
       VALUES ($1, $2, $3)
       RETURNING id, photo_url, is_primary, created_at`,
      [id, storedPath, isFirst]
    );

    const p = result.rows[0];
    console.log("  Photo stored:", photoUrl);
    return res.status(201).json({
      success: true,
      message: "Photo uploaded",
      data: {
        id: p.id,
        photoUrl,
        isPrimary: p.is_primary,
        createdAt: p.created_at,
      },
    });
  } catch (error) {
    console.error("Upload property photo error:", error);
    if (req.file) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ success: false, message: "File too large. Maximum size is 10MB." });
    }
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Delete a property photo
router.delete("/properties/:propertyId/photos/:photoId", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { propertyId, photoId } = req.params;

    const photoCheck = await assertOwnerPhoto(uid, propertyId, photoId);
    if (!photoCheck.ok) {
      return res.status(photoCheck.status).json({ success: false, message: photoCheck.message });
    }

    // Get the photo file path before deleting from DB
    const photoResult = await pool.query(
      `SELECT id, photo_url, is_primary FROM property_photos WHERE id = $1`,
      [photoId]
    );
    const photo = photoResult.rows[0];

    // Delete from DB
    await pool.query(`DELETE FROM property_photos WHERE id = $1`, [photoId]);

    // If deleted photo was primary, promote the oldest remaining photo.
    // PostgreSQL does not support ORDER BY/LIMIT directly in UPDATE, so the
    // target row is selected in a subquery.
    if (photo.is_primary) {
      await pool.query(
        `UPDATE property_photos SET is_primary = true
         WHERE id = (
           SELECT id FROM property_photos
           WHERE property_id = $1
           ORDER BY created_at ASC
           LIMIT 1
         )`,
        [propertyId]
      );
    }

    // Delete the file from disk
    if (photo.photo_url) {
      try {
        const pathname = /^https?:\/\//i.test(photo.photo_url)
          ? new URL(photo.photo_url).pathname
          : photo.photo_url;
        const filePath = path.join(__dirname, "..", pathname.replace(/^\/+/, ""));
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {}
    }

    return res.json({ success: true, message: "Photo deleted" });
  } catch (error) {
    console.error("Delete property photo error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Set a photo as primary
router.patch("/properties/:propertyId/photos/:photoId/primary", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { propertyId, photoId } = req.params;

    const photoCheck = await assertOwnerPhoto(uid, propertyId, photoId);
    if (!photoCheck.ok) {
      return res.status(photoCheck.status).json({ success: false, message: photoCheck.message });
    }

    // Unset all primary, then set this one
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE property_photos SET is_primary = false WHERE property_id = $1`,
        [propertyId]
      );
      await client.query(
        `UPDATE property_photos SET is_primary = true WHERE id = $1 AND property_id = $2`,
        [photoId, propertyId]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    return res.json({ success: true, message: "Primary photo updated" });
  } catch (error) {
    console.error("Set primary photo error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;