const bcrypt = require("bcryptjs");
const pool = require("./db");

async function createTestUser() {
  try {
    const password = "Admin123!";
    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `
      INSERT INTO users (
        name,
        email,
        password_hash,
        role,
        status,
        email_verified
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, name, email, role, status
      `,
      [
        "System Administrator",
        "admin@pagdagusan.com",
        passwordHash,
        "admin",
        "active",
        true,
      ]
    );

    console.log("User created:");
    console.log(result.rows[0]);

    process.exit(0);
  } catch (error) {
    console.error("Error creating user:", error);
    process.exit(1);
  }
}

createTestUser();