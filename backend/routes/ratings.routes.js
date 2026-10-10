const express = require("express");
const pool = require("../db");
const requireAuth = require("../middleware/auth");
const requireRole = require("../middleware/role");
const { notifyRatingReceived } = require("../services/notifications");

const router = express.Router();

router.use(requireAuth);
router.use(requireRole("owner", "tenant"));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_COMMENT = 500;
const RATEABLE_LEASE_STATUSES = ["active", "completed", "terminated"];

function mapRating(row) {
  return {
    id: row.id,
    raterId: row.rater_id,
    raterName: row.rater_name,
    rateeId: row.ratee_id,
    stars: row.stars,
    comment: row.comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSummary(row) {
  return {
    userId: row.user_id,
    averageStars: Number(row.average_stars || 0),
    ratingCount: Number(row.rating_count || 0),
    fiveStarCount: Number(row.five_star_count || 0),
  };
}

async function getUserRole(userId) {
  const result = await pool.query(`SELECT id, name, role, status FROM users WHERE id = $1 LIMIT 1`, [userId]);
  return result.rows[0] || null;
}

// A rating is allowed only when the two users actually shared a lease
// (not a pending application). Owner rates that tenant; tenant rates that owner.
async function hasRateableLease(ownerId, tenantId, propertyId) {
  const params = [ownerId, tenantId, RATEABLE_LEASE_STATUSES];
  let propertyClause = "";
  if (propertyId) {
    params.push(propertyId);
    propertyClause = " AND r.property_id = $4";
  }
  const result = await pool.query(
    `SELECT 1
     FROM leases l
     JOIN rooms r ON r.id = l.room_id
     JOIN properties p ON p.id = r.property_id
     WHERE p.owner_id = $1
       AND l.tenant_id = $2
       AND l.status::text = ANY($3::text[])
       ${propertyClause}
     LIMIT 1`,
    params
  );
  return result.rows.length > 0;
}

async function canRate(rater, ratee, propertyId) {
  if (!rater || !ratee) return false;
  if (rater.id === ratee.id) return false;
  if (rater.role === "tenant" && ratee.role === "owner") {
    return hasRateableLease(ratee.id, rater.id, propertyId);
  }
  if (rater.role === "owner" && ratee.role === "tenant") {
    return hasRateableLease(rater.id, ratee.id, propertyId);
  }
  return false;
}

// propertyId limits the summary to tenants who stayed at that dorm.
// Without it, the summary stays the owner's overall rating.
function propertyLeaseFilter(propertyId, propertyParam, statusParam, raterColumn) {
  if (!propertyId) return "";
  return ` AND EXISTS (
    SELECT 1
    FROM leases l
    JOIN rooms rm ON rm.id = l.room_id
    WHERE rm.property_id = ${propertyParam}
      AND l.tenant_id = ${raterColumn}
      AND l.status::text = ANY(${statusParam}::text[])
  )`;
}

async function loadSummary(userId, propertyId) {
  const params = [userId];
  let filter = "";
  if (propertyId) {
    params.push(propertyId, RATEABLE_LEASE_STATUSES);
    filter = propertyLeaseFilter(propertyId, "$2", "$3", "ratings.rater_id");
  }
  const result = await pool.query(
    `SELECT
       $1::uuid AS user_id,
       COALESCE(ROUND(AVG(stars)::numeric, 1), 0) AS average_stars,
       COUNT(*)::int AS rating_count,
       COUNT(*) FILTER (WHERE stars = 5)::int AS five_star_count
     FROM ratings
     WHERE ratee_id = $1
       ${filter}`,
    params
  );
  return mapSummary(result.rows[0]);
}

// GET /api/ratings/users/:userId
// Public (to signed-in owners/tenants) summary + recent comments, plus whether
// the caller may rate this person and the caller's existing rating if any.
router.get("/users/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    if (!UUID_RE.test(userId)) {
      return res.status(400).json({ success: false, message: "Invalid user id" });
    }

    const ratee = await getUserRole(userId);
    if (!ratee || (ratee.role !== "owner" && ratee.role !== "tenant")) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const propertyId = typeof req.query.propertyId === "string" && req.query.propertyId
      ? req.query.propertyId
      : null;
    if (propertyId && !UUID_RE.test(propertyId)) {
      return res.status(400).json({ success: false, message: "Invalid property id" });
    }

    const rater = { id: req.user.userId, role: req.user.role };
    const listParams = [userId];
    let listFilter = "";
    if (propertyId) {
      listParams.push(propertyId, RATEABLE_LEASE_STATUSES);
      listFilter = propertyLeaseFilter(propertyId, "$2", "$3", "r.rater_id");
    }
    const mineParams = [req.user.userId, userId];
    let mineFilter = "";
    if (propertyId) {
      mineParams.push(propertyId, RATEABLE_LEASE_STATUSES);
      mineFilter = propertyLeaseFilter(propertyId, "$3", "$4", "r.rater_id");
    }

    const [summary, listResult, mineResult, allowed] = await Promise.all([
      loadSummary(userId, propertyId),
      pool.query(
        `SELECT r.id, r.rater_id, u.name AS rater_name, r.ratee_id, r.stars, r.comment,
                r.created_at, r.updated_at
         FROM ratings r
         JOIN users u ON u.id = r.rater_id
         WHERE r.ratee_id = $1
           ${listFilter}
         ORDER BY r.created_at DESC
         LIMIT 50`,
        listParams
      ),
      pool.query(
        `SELECT r.id, r.rater_id, u.name AS rater_name, r.ratee_id, r.stars, r.comment,
                r.created_at, r.updated_at
         FROM ratings r
         JOIN users u ON u.id = r.rater_id
         WHERE r.rater_id = $1 AND r.ratee_id = $2
           ${mineFilter}
         LIMIT 1`,
        mineParams
      ),
      canRate(rater, ratee, propertyId),
    ]);

    return res.json({
      success: true,
      data: {
        userId: ratee.id,
        name: ratee.name,
        role: ratee.role,
        summary,
        ratings: listResult.rows.map(mapRating),
        myRating: mineResult.rows[0] ? mapRating(mineResult.rows[0]) : null,
        canRate: allowed,
      },
    });
  } catch (error) {
    console.error("Get ratings error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// POST /api/ratings
// Create or update the caller's rating of another user.
router.post("/", async (req, res) => {
  const client = await pool.connect();
  try {
    const raterId = req.user.userId;
    const raterRole = req.user.role;
    const { rateeId, stars, comment } = req.body || {};

    if (typeof rateeId !== "string" || !UUID_RE.test(rateeId)) {
      return res.status(400).json({ success: false, message: "A valid rateeId is required" });
    }

    const starValue = Number(stars);
    if (!Number.isInteger(starValue) || starValue < 1 || starValue > 5) {
      return res.status(400).json({ success: false, message: "Stars must be a whole number from 1 to 5" });
    }

    let trimmedComment = null;
    if (comment != null && String(comment).trim()) {
      trimmedComment = String(comment).trim();
      if (trimmedComment.length > MAX_COMMENT) {
        return res.status(400).json({
          success: false,
          message: `Comment must be ${MAX_COMMENT} characters or fewer`,
        });
      }
    }

    if (rateeId === raterId) {
      return res.status(400).json({ success: false, message: "You cannot rate yourself" });
    }

    const [raterUser, ratee] = await Promise.all([
      getUserRole(raterId),
      getUserRole(rateeId),
    ]);

    if (!ratee || (ratee.role !== "owner" && ratee.role !== "tenant")) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const allowed = await canRate({ id: raterId, role: raterRole }, ratee);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        message: "You can only rate someone you have an active or past lease with",
      });
    }

    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT id FROM ratings WHERE rater_id = $1 AND ratee_id = $2 LIMIT 1`,
      [raterId, rateeId]
    );
    const isNew = existing.rows.length === 0;

    const result = await client.query(
      `INSERT INTO ratings (rater_id, ratee_id, stars, comment)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (rater_id, ratee_id)
       DO UPDATE SET stars = EXCLUDED.stars, comment = EXCLUDED.comment, updated_at = NOW()
       RETURNING id, rater_id, ratee_id, stars, comment, created_at, updated_at`,
      [raterId, rateeId, starValue, trimmedComment]
    );

    const row = result.rows[0];

    if (isNew) {
      await notifyRatingReceived(client, {
        rateeId,
        raterId,
        raterName: raterUser?.name || "A user",
        stars: starValue,
      });
    }

    await client.query("COMMIT");

    return res.status(isNew ? 201 : 200).json({
      success: true,
      message: isNew ? "Rating submitted" : "Rating updated",
      data: {
        id: row.id,
        raterId: row.rater_id,
        raterName: raterUser?.name || null,
        rateeId: row.ratee_id,
        stars: row.stars,
        comment: row.comment,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Submit rating error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
});

module.exports = router;
