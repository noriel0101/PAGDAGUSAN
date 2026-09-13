const express = require("express");
const cors = require("cors");
require("dotenv").config();

const pool = require("./db");
const authRoutes = require("./routes/auth.routes");
const adminRoutes = require("./routes/admin.routes");
const ownerRoutes = require("./routes/owner.routes");
const tenantRoutes = require("./routes/tenant.routes");
const messagesRoutes = require("./routes/messages");
const catalogRoutes = require("./routes/catalog.routes");
const ownerReportsRoutes = require("./routes/ownerReports");
const adminReportsRoutes = require("./routes/adminReports");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/reports", adminReportsRoutes);
app.use("/api/owner", ownerRoutes);
app.use("/api/owner/reports", ownerReportsRoutes);
app.use("/api/tenant", tenantRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api", catalogRoutes);
app.get("/", (req, res) => {
  res.json({
    message: "Pagdagusan API is running",
  });
});

app.get("/api/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS current_time");

    res.json({
      success: true,
      message: "PostgreSQL connection successful",
      databaseTime: result.rows[0].current_time,
    });
  } catch (error) {
    console.error("Database error:", error);

    res.status(500).json({
      success: false,
      message: "PostgreSQL connection failed",
    });
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Pagdagusan API running on port ${PORT}`);
});