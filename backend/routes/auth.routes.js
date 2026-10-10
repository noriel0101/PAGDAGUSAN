const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const pool = require("../db");
const requireAuth = require("../middleware/auth");
const { notifyAdminsOfOwnerRegistration } = require("../services/notifications");
const { formatError, emailTypoError } = require("../lib/email");
const { sendLoginCode, sendPasswordReset, mailConfig } = require("../lib/mailer");
const { verifyGoogleIdToken } = require("../lib/google");

const router = express.Router();

const CODE_TTL_MINUTES = 10;
const MAX_CODE_ATTEMPTS = 5;
const RESET_ROLES = new Set(["admin", "owner", "tenant"]);

function passwordRuleError(password) {
  if (!password || password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return "Password must be at least 8 characters long and include a letter and a number";
  }
  return null;
}

function canResetAccount(user) {
  if (!user) return false;
  if (user.status === "active") return true;
  return user.role === "owner" && user.status === "pending";
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
  };
}

async function issueSession(user) {
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

  return { token, user: publicUser(user) };
}

async function startEmailLogin(user) {
  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = await bcrypt.hash(code, 10);

  await pool.query(
    `
    UPDATE login_codes
    SET used_at = NOW()
    WHERE user_id = $1 AND used_at IS NULL
    `,
    [user.id]
  );

  const inserted = await pool.query(
    `
    INSERT INTO login_codes (user_id, code_hash, expires_at)
    VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval)
    RETURNING id
    `,
    [user.id, codeHash, String(CODE_TTL_MINUTES)]
  );

  const challengeId = inserted.rows[0].id;

  try {
    await sendLoginCode(user.email, code, { name: user.name, role: user.role });
  } catch (error) {
    await pool.query(`DELETE FROM login_codes WHERE id = $1`, [challengeId]);
    const failure = new Error(
      error.code === "MAIL_UNCONFIGURED"
        ? "Sign-in email is not set up yet. Add the mail settings on the server, then try again."
        : "We could not send the sign-in code. Try again in a moment."
    );
    failure.status = 503;
    throw failure;
  }

  return challengeId;
}

router.post("/login", async (req, res) => {
  try {
    const { email, password, expectedRole } = req.body;

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

    if (expectedRole && expectedRole !== user.role) {
      const label =
        user.role === "owner"
          ? "Dorm Owner"
          : user.role.charAt(0).toUpperCase() + user.role.slice(1);
      return res.status(403).json({
        success: false,
        message: `This account is a ${user.role}. Use the ${label} login portal instead.`,
      });
    }

    const session = await issueSession(user);

    return res.json({
      success: true,
      message: "Login successful",
      token: session.token,
      user: session.user,
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Server error",
    });
  }
});

router.post("/verify-login", async (req, res) => {
  try {
    const { challengeId, code } = req.body;
    const codeText = code == null ? "" : String(code).trim();

    if (!challengeId || !/^\d{6}$/.test(codeText)) {
      return res.status(400).json({
        success: false,
        message: "Enter the 6-digit code from your email",
      });
    }

    const result = await pool.query(
      `
      SELECT
        c.id,
        c.code_hash,
        c.expires_at,
        c.attempts,
        c.used_at,
        u.id AS user_id,
        u.name,
        u.email,
        u.phone,
        u.role,
        u.status
      FROM login_codes c
      JOIN users u ON u.id = c.user_id
      WHERE c.id = $1
      LIMIT 1
      `,
      [challengeId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "That sign-in code is no longer valid. Sign in again.",
      });
    }

    const row = result.rows[0];

    if (row.used_at) {
      return res.status(400).json({
        success: false,
        message: "That code was already used. Sign in again.",
      });
    }

    if (new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "That code expired. Sign in again to get a new one.",
      });
    }

    if (row.attempts >= MAX_CODE_ATTEMPTS) {
      return res.status(429).json({
        success: false,
        message: "Too many tries. Sign in again to get a new code.",
      });
    }

    if (row.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "This account is not active",
      });
    }

    const codeMatch = await bcrypt.compare(codeText, row.code_hash);

    if (!codeMatch) {
      await pool.query(
        `UPDATE login_codes SET attempts = attempts + 1 WHERE id = $1`,
        [row.id]
      );
      return res.status(401).json({
        success: false,
        message: "That code is incorrect.",
      });
    }

    const consumed = await pool.query(
      `
      UPDATE login_codes
      SET used_at = NOW(), attempts = attempts + 1
      WHERE id = $1 AND used_at IS NULL
      RETURNING id
      `,
      [row.id]
    );

    if (consumed.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "That code was already used. Sign in again.",
      });
    }

    const session = await issueSession({
      id: row.user_id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      role: row.role,
    });

    return res.json({
      success: true,
      message: "Login successful",
      token: session.token,
      user: session.user,
    });
  } catch (error) {
    console.error("Verify login error:", error);
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

    const typo = emailTypoError(trimmedEmail);
    if (typo) {
      return res.status(400).json({
        success: false,
        message: typo,
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

    // The pending owner account and the admins' notifications are committed
    // together, so an admin is never told about an owner that failed to save.
    const client = await pool.connect();
    let user;
    try {
      await client.query("BEGIN");

      const result = await client.query(
        `
        INSERT INTO users (name, email, phone, password_hash, role, status, email_verified)
        VALUES ($1, $2, $3, $4, 'owner', 'pending', false)
        RETURNING id, name, email, phone, role, status, created_at
        `,
        [trimmedName, trimmedEmail, trimmedPhone, passwordHash]
      );

      user = result.rows[0];

      await notifyAdminsOfOwnerRegistration(client, {
        ownerId: user.id,
        ownerName: user.name,
        ownerEmail: user.email,
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

router.post("/register-tenant", async (req, res) => {
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

    const emailError = formatError(trimmedEmail);
    if (emailError) {
      return res.status(400).json({
        success: false,
        message: emailError,
      });
    }
    const normalizedEmail = trimmedEmail.toLowerCase();

    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters long and include a letter and a number",
      });
    }

    const existing = await pool.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [normalizedEmail]
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
      VALUES ($1, $2, $3, $4, 'tenant', 'active', true)
      RETURNING id, name, email, phone, role, status, created_at
      `,
      [trimmedName, normalizedEmail, trimmedPhone, passwordHash]
    );

    const user = result.rows[0];

    return res.status(201).json({
      success: true,
      message: "Tenant account created. You can now sign in to browse dormitories and apply for rooms.",
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
    console.error("Register tenant error:", error);
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

function accountStatusError(user) {
  if (user.status === "active") return null;
  if (user.role === "owner" && user.status === "pending") {
    return "Your Dorm Owner account is waiting for Admin approval.";
  }
  if (user.role === "owner" && user.status === "rejected") {
    return "Your Dorm Owner registration was not approved.";
  }
  if (user.status === "inactive") {
    return "Your account has been deactivated.";
  }
  return "This account is not active";
}

router.post("/google", async (req, res) => {
  try {
    const expectedRole = req.body.expectedRole;
    if (expectedRole !== "owner" && expectedRole !== "tenant") {
      return res.status(400).json({
        success: false,
        message: "Choose Dorm Owner or Tenant for Google sign-in.",
      });
    }

    const profile = await verifyGoogleIdToken(req.body.idToken);
    const existing = await pool.query(
      `
      SELECT id, name, email, phone, role, status
      FROM users
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1
      `,
      [profile.email]
    );

    let user = existing.rows[0];
    if (!user) {
      const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12);
      if (expectedRole === "tenant") {
        const created = await pool.query(
          `
          INSERT INTO users (name, email, phone, password_hash, role, status, email_verified)
          VALUES ($1, $2, NULL, $3, 'tenant', 'active', true)
          RETURNING id, name, email, phone, role, status
          `,
          [profile.name, profile.email, passwordHash]
        );
        user = created.rows[0];
      } else {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const created = await client.query(
            `
            INSERT INTO users (name, email, phone, password_hash, role, status, email_verified)
            VALUES ($1, $2, NULL, $3, 'owner', 'pending', true)
            RETURNING id, name, email, phone, role, status
            `,
            [profile.name, profile.email, passwordHash]
          );
          user = created.rows[0];
          await notifyAdminsOfOwnerRegistration(client, {
            ownerId: user.id,
            ownerName: user.name,
            ownerEmail: user.email,
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
          message: "Registration submitted. Your account is waiting for Admin approval.",
        });
      }
    }

    if (user.role !== expectedRole) {
      const label =
        user.role === "owner"
          ? "Dorm Owner"
          : user.role.charAt(0).toUpperCase() + user.role.slice(1);
      return res.status(403).json({
        success: false,
        message: `This account is a ${user.role}. Use the ${label} login portal instead.`,
      });
    }

    const statusError = accountStatusError(user);
    if (statusError) {
      return res.status(403).json({
        success: false,
        message: statusError,
      });
    }

    const session = await issueSession(user);
    return res.json({
      success: true,
      message: "Login successful",
      token: session.token,
      user: session.user,
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists. Try Google sign-in again.",
      });
    }
    console.error("Google sign-in error:", error.message || error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Server error",
    });
  }
});

router.post("/forgot-password", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim();
    const expectedRole = req.body.expectedRole;
    const generic = {
      success: true,
      message:
        "If that email belongs to this account type, we sent a 6-digit reset code. It expires in 10 minutes.",
    };

    if (!RESET_ROLES.has(expectedRole)) {
      return res.status(400).json({
        success: false,
        message: "Choose Admin, Dorm Owner, or Tenant.",
      });
    }

    const format = formatError(email);
    if (format) {
      return res.status(400).json({
        success: false,
        message: format,
      });
    }

    if (!mailConfig()) {
      return res.status(503).json({
        success: false,
        message:
          "Password reset email is not set up yet. Add the mail settings on the server, then try again.",
      });
    }

    const result = await pool.query(
      `
      SELECT id, name, email, role, status
      FROM users
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1
      `,
      [email]
    );

    const user = result.rows[0];
    if (!user || user.role !== expectedRole || !canResetAccount(user)) {
      return res.json(generic);
    }

    const recent = await pool.query(
      `
      SELECT id
      FROM password_resets
      WHERE user_id = $1
        AND used_at IS NULL
        AND created_at > NOW() - INTERVAL '60 seconds'
      LIMIT 1
      `,
      [user.id]
    );

    if (recent.rows.length > 0) {
      return res.json({
        success: true,
        message: "A reset code was just sent. Check your email, including spam.",
      });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const codeHash = await bcrypt.hash(code, 10);

    await pool.query(
      `
      UPDATE password_resets
      SET used_at = NOW()
      WHERE user_id = $1 AND used_at IS NULL
      `,
      [user.id]
    );

    const inserted = await pool.query(
      `
      INSERT INTO password_resets (user_id, code_hash, expires_at)
      VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval)
      RETURNING id
      `,
      [user.id, codeHash, String(CODE_TTL_MINUTES)]
    );

    try {
      await sendPasswordReset(user.email, code, { name: user.name, role: user.role });
    } catch (error) {
      await pool.query(`DELETE FROM password_resets WHERE id = $1`, [inserted.rows[0].id]);
      console.error("Password reset email error:", error.message);
      return res.status(503).json({
        success: false,
        message: "We could not send the reset code. Try again in a moment.",
      });
    }

    return res.json(generic);
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim();
    const codeText = req.body.code == null ? "" : String(req.body.code).trim();
    const newPassword = req.body.newPassword == null ? "" : String(req.body.newPassword);
    const expectedRole = req.body.expectedRole;

    if (!RESET_ROLES.has(expectedRole)) {
      return res.status(400).json({
        success: false,
        message: "Choose Admin, Dorm Owner, or Tenant.",
      });
    }

    if (!/^\d{6}$/.test(codeText)) {
      return res.status(400).json({
        success: false,
        message: "Enter the 6-digit code from your email",
      });
    }

    const ruleError = passwordRuleError(newPassword);
    if (ruleError) {
      return res.status(400).json({
        success: false,
        message: ruleError,
      });
    }

    const result = await pool.query(
      `
      SELECT
        r.id,
        r.code_hash,
        r.expires_at,
        r.attempts,
        r.used_at,
        u.id AS user_id,
        u.role,
        u.status
      FROM password_resets r
      JOIN users u ON u.id = r.user_id
      WHERE LOWER(u.email) = LOWER($1)
        AND u.role = $2
        AND r.used_at IS NULL
      ORDER BY r.created_at DESC
      LIMIT 1
      `,
      [email, expectedRole]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "That reset code is not valid. Request a new one.",
      });
    }

    const row = result.rows[0];

    if (!canResetAccount(row)) {
      return res.status(403).json({
        success: false,
        message: "This account is not active",
      });
    }

    if (new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "That code expired. Request a new one.",
      });
    }

    if (row.attempts >= MAX_CODE_ATTEMPTS) {
      return res.status(429).json({
        success: false,
        message: "Too many tries. Request a new code.",
      });
    }

    const codeMatch = await bcrypt.compare(codeText, row.code_hash);
    if (!codeMatch) {
      await pool.query(`UPDATE password_resets SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
      return res.status(400).json({
        success: false,
        message: "That code is incorrect.",
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const consumed = await client.query(
        `
        UPDATE password_resets
        SET used_at = NOW(), attempts = attempts + 1
        WHERE id = $1 AND used_at IS NULL
        RETURNING id
        `,
        [row.id]
      );

      if (consumed.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          success: false,
          message: "That code was already used. Request a new one.",
        });
      }

      await client.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, row.user_id]);
      await client.query(
        `
        UPDATE password_resets
        SET used_at = NOW()
        WHERE user_id = $1 AND used_at IS NULL
        `,
        [row.user_id]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return res.json({
      success: true,
      message: "Password updated. Sign in with your new password.",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

router.post("/change-password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required",
      });
    }

    const ruleError = passwordRuleError(newPassword);
    if (ruleError) {
      return res.status(400).json({
        success: false,
        message: ruleError,
      });
    }

    const result = await pool.query(
      `SELECT password_hash FROM users WHERE id = $1`,
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const matches = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!matches) {
      return res.status(400).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
      passwordHash,
      req.user.userId,
    ]);

    return res.json({
      success: true,
      message: "Password updated",
    });
  } catch (error) {
    console.error("Change password error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

module.exports = router;