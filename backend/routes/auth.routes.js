const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const pool = require("../db");
const requireAuth = require("../middleware/auth");

const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const result = await pool.query(
      `
      SELECT
        id,
        name,
        email,
        phone,
        role,
        password_hash,
        status
      FROM users
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1
      `,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const user = result.rows[0];

    if (user.status !== "active") {
      if (user.role === "owner") {
        if (user.status === "pending") {
          return res.status(403).json({
            success: false,
            message: "Your Dorm Owner account is waiting for Admin approval.",
          });
        }
        if (user.status === "rejected") {
          return res.status(403).json({
            success: false,
            message: "Your Dorm Owner registration was not approved.",
          });
        }
      }
      if (user.status === "inactive") {
        return res.status(403).json({
          success: false,
          message: "Your account has been deactivated.",
        });
      }
      return res.status(403).json({
        success: false,
        message: "This account is not active",
      });
    }

    const passwordMatch = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const token = jwt.sign(
      {
        userId: user.id,
        role: user.role,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d",
      }
    );

    await pool.query(
      `
      UPDATE users
      SET last_login_at = NOW()
      WHERE id = $1
      `,
      [user.id]
    );

    return res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

router.post("/register-owner", async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and password are required",
      });
    }

    const trimmedName = String(name).trim();
    const trimmedEmail = String(email).trim();
    const trimmedPhone = phone ? String(phone).trim() : null;

    if (trimmedName.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Name must be at least 2 characters long",
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid email address",
      });
    }

    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters long and include a letter and a number",
      });
    }

    const existing = await pool.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [trimmedEmail]
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
      VALUES ($1, $2, $3, $4, 'owner', 'pending', false)
      RETURNING id, name, email, phone, role, status, created_at
      `,
      [trimmedName, trimmedEmail, trimmedPhone, passwordHash]
    );

    const user = result.rows[0];

    return res.status(201).json({
      success: true,
      message: "Registration submitted. Your account is waiting for Admin approval.",
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
    console.error("Register owner error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, name, email, phone, role, status, created_at, last_login_at
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const user = result.rows[0];

    return res.json({
      success: true,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        createdAt: user.created_at,
        lastLoginAt: user.last_login_at,
      },
    });
  } catch (error) {
    console.error("Get user error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

router.post("/logout", requireAuth, async (req, res) => {
  return res.json({
    success: true,
    message: "Logged out successfully",
  });
});

module.exports = router;