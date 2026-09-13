const bcrypt = require("bcryptjs");
const pool = require("./db");

async function ensureUser({ email, password, name, role, status, verified }) {
  const existing = await pool.query(
    `SELECT id, name, role, status FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email]
  );
  const hash = await bcrypt.hash(password, 12);
  if (existing.rows.length > 0) {
    const u = existing.rows[0];
    await pool.query(
      `UPDATE users SET password_hash = $1, name = $2, role = $3, status = $4, email_verified = $5, updated_at = NOW() WHERE id = $6`,
      [hash, name, role, status, verified, u.id]
    );
    console.log(`UPDATED ${email} => role=${role}, status=${status}`);
  } else {
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role, status, email_verified) VALUES ($1, $2, $3, $4, $5, $6)`,
      [name, email, hash, role, status, verified]
    );
    console.log(`CREATED ${email} => role=${role}, status=${status}`);
  }
}

(async () => {
  await ensureUser({
    email: "admin@pagdagusan.com",
    password: "Admin123!",
    name: "System Admin",
    role: "admin",
    status: "active",
    verified: true,
  });
  await ensureUser({
    email: "owner@pagdagusan.com",
    password: "Owner123!",
    name: "Demo Dorm Owner",
    role: "owner",
    status: "active",
    verified: true,
  });
  await ensureUser({
    email: "tenant@pagdagusan.com",
    password: "Tenant123!",
    name: "Demo Tenant",
    role: "tenant",
    status: "active",
    verified: true,
  });
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });