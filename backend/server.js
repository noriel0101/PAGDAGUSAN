const express = require("express");
const cors = require("cors");
require("dotenv").config();

const pool = require("./db");
const authRoutes = require("./routes/auth.routes");
const adminRoutes = require("./routes/admin.routes");
const ownerRoutes = require("./routes/owner.routes");
const tenantRoutes = require("./routes/tenant.routes");
const messagesRoutes = require("./routes/messages");
const notificationsRoutes = require("./routes/notifications.routes");
const ratingsRoutes = require("./routes/ratings.routes");
const catalogRoutes = require("./routes/catalog.routes");
const ownerReportsRoutes = require("./routes/ownerReports");
const adminReportsRoutes = require("./routes/adminReports");

const path = require("path");
const app = express();

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/reports", adminReportsRoutes);
app.use("/api/owner", ownerRoutes);
app.use("/api/owner/reports", ownerReportsRoutes);
app.use("/api/tenant", tenantRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/ratings", ratingsRoutes);
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

// Unknown routes return JSON, never an HTML page.
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// Central error handler. Ensures body-parser/multer/async errors are always
// returned as JSON so the mobile app can read `message` instead of choking on
// an HTML error page.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (res.headersSent) {
    return next(err);
  }
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    success: false,
    message: err.message || "Server error",
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Pagdagusan API running on port ${PORT} (0.0.0.0)`);
});