const express = require("express");
const bcrypt = require("bcryptjs");

const pool = require("../db");
const requireAuth = require("../middleware/auth");
const requireRole = require("../middleware/role");

const router = express.Router();

router.use(requireAuth);
router.use(requireRole("admin"));

router.get("/stats", async (req, res) => {
  try {
    const ownersResult = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'active')::int AS active,
        COUNT(*) FILTER (WHERE status = 'inactive')::int AS inactive
      FROM users
      WHERE role = 'owner'
    `);

    return res.json({
      success: true,
      data: {
        owners: ownersResult.rows[0],
      },
    });
  } catch (error) {
    console.error("Admin stats error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/owners", async (req, res) => {
  try {
    const { search, status } = req.query;
    let query = `
      SELECT
        u.id,
        u.name,
        u.email,
        u.phone,
        u.status,
        u.created_at,
        u.last_login_at,
        COALESCE(p.property_count, 0)::int AS property_count
      FROM users u
      LEFT JOIN (
        SELECT owner_id, COUNT(*)::int AS property_count
        FROM properties
        GROUP BY owner_id
      ) p ON p.owner_id = u.id
      WHERE u.role = 'owner'
    `;
    const params = [];
    let paramIndex = 1;

    if (search) {
      query += ` AND (LOWER(u.name) LIKE LOWER($${paramIndex}) OR LOWER(u.email) LIKE LOWER($${paramIndex}))`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (status && status !== "all") {
      query += ` AND u.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    query += ` ORDER BY (u.status = 'pending') DESC, u.created_at DESC`;

    const result = await pool.query(query, params);

    return res.json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        status: row.status,
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at,
        propertyCount: row.property_count,
      })),
    });
  } catch (error) {
    console.error("Get owners error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/owners/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT
        u.id,
        u.name,
        u.email,
        u.phone,
        u.status,
        u.created_at,
        u.last_login_at,
        u.email_verified
      FROM users u
      WHERE u.id = $1 AND u.role = 'owner'
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Owner not found" });
    }

    const owner = result.rows[0];

    const propertiesResult = await pool.query(
      `
      SELECT id, name, address, created_at
      FROM properties
      WHERE owner_id = $1
      ORDER BY created_at DESC
      `,
      [id]
    );

    return res.json({
      success: true,
      data: {
        id: owner.id,
        name: owner.name,
        email: owner.email,
        phone: owner.phone,
        status: owner.status,
        createdAt: owner.created_at,
        lastLoginAt: owner.last_login_at,
        emailVerified: owner.email_verified,
        properties: propertiesResult.rows.map((p) => ({
          id: p.id,
          name: p.name,
          address: p.address,
          createdAt: p.created_at,
        })),
      },
    });
  } catch (error) {
    console.error("Get owner error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post("/owners", async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and password are required",
      });
    }

    const existing = await pool.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1)`,
      [email]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `
      INSERT INTO users (name, email, phone, password_hash, role, status, email_verified)
      VALUES ($1, $2, $3, $4, 'owner', 'active', false)
      RETURNING id, name, email, phone, role, status, created_at
      `,
      [name, email, phone || null, passwordHash]
    );

    const user = result.rows[0];

    return res.status(201).json({
      success: true,
      message: "Owner created successfully",
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        createdAt: user.created_at,
      },
    });
  } catch (error) {
    console.error("Create owner error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.put("/owners/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        success: false,
        message: "Name and email are required",
      });
    }

    const existing = await pool.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2 AND role = 'owner'`,
      [email, id]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Another owner already uses this email",
      });
    }

    const result = await pool.query(
      `
      UPDATE users
      SET name = $1, email = $2, phone = $3, updated_at = NOW()
      WHERE id = $4 AND role = 'owner'
      RETURNING id, name, email, phone, role, status, created_at
      `,
      [name, email, phone || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Owner not found" });
    }

    const user = result.rows[0];

    return res.json({
      success: true,
      message: "Owner updated successfully",
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        createdAt: user.created_at,
      },
    });
  } catch (error) {
    console.error("Update owner error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.patch("/owners/:id/approve", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      UPDATE users
      SET status = 'active', updated_at = NOW()
      WHERE id = $1 AND role = 'owner'
      RETURNING id, name, email, phone, role, status
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Owner not found" });
    }

    const user = result.rows[0];

    return res.json({
      success: true,
      message: "Owner approved successfully",
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
      },
    });
  } catch (error) {
    console.error("Approve owner error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.patch("/owners/:id/reject", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      UPDATE users
      SET status = 'rejected', updated_at = NOW()
      WHERE id = $1 AND role = 'owner'
      RETURNING id, name, email, phone, role, status
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Owner not found" });
    }

    const user = result.rows[0];

    return res.json({
      success: true,
      message: "Owner registration rejected",
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
      },
    });
  } catch (error) {
    console.error("Reject owner error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.patch("/owners/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !["active", "inactive"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be 'active' or 'inactive'",
      });
    }

    const result = await pool.query(
      `
      UPDATE users
      SET status = $1
      WHERE id = $2 AND role = 'owner'
      RETURNING id, name, email, phone, role, status
      `,
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Owner not found" });
    }

    const user = result.rows[0];

    return res.json({
      success: true,
      message: `Owner ${status === "active" ? "activated" : "deactivated"} successfully`,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
      },
    });
  } catch (error) {
    console.error("Update owner status error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/activity", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        id,
        user_id,
        action,
        details,
        created_at
      FROM audit_logs
      ORDER BY created_at DESC
      LIMIT 50
      `
    );

    return res.json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        action: row.action,
        details: row.details,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    console.error("Get activity error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
