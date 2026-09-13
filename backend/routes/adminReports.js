const express = require("express");
const pool = require("../db");
const requireAuth = require("../middleware/auth");
const requireRole = require("../middleware/role");

const router = express.Router();

router.use(requireAuth);
router.use(requireRole("admin"));

// Admin manages Dorm Owners ONLY. This report is limited to owner-level and
// system-level owner statistics; no tenant management data is ever exposed.

router.get("/summary", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         COUNT(*)::int AS total_owners,
         COUNT(*) FILTER (WHERE status = 'active')::int AS active_owners,
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_owners,
         COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected_owners,
         COUNT(*) FILTER (WHERE status = 'inactive')::int AS inactive_owners,
         COUNT(*) FILTER (WHERE status = 'suspended')::int AS suspended_owners
       FROM users
       WHERE role = 'owner'`
    );

    const row = result.rows[0];
    return res.json({
      success: true,
      data: {
        summary: {
          totalOwners: row.total_owners,
          activeOwners: row.active_owners,
          pendingOwners: row.pending_owners,
          rejectedOwners: row.rejected_owners,
          inactiveOwners: row.inactive_owners,
          suspendedOwners: row.suspended_owners,
        },
      },
    });
  } catch (error) {
    console.error("Admin report summary error:", error);
    return res.status(500).json({ success: false, message: "Unable to load report" });
  }
});

module.exports = router;