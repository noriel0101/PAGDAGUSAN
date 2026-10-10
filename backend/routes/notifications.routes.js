const express = require("express");
const pool = require("../db");
const requireAuth = require("../middleware/auth");

const router = express.Router();

// Every route below requires a valid JWT. The recipient is ALWAYS taken from
// req.user.userId — a notification is never selectable by id alone, so one user
// can never read, list or mark another user's notifications.
router.use(requireAuth);

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 30;

// Maps a notifications row to the camelCase shape the mobile client consumes.
function mapNotification(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    relatedId: row.related_id,
    relatedType: row.related_type,
    isRead: row.is_read,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

// GET /api/notifications
//   ?unread=true  → only unread rows
//   ?since=ISO    → only rows created after that timestamp (used by the client
//                   poller to detect newly-arrived notifications)
//   ?limit=       → 1..100, default 30
router.get("/", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { unread, since, limit } = req.query;

    const conditions = ["recipient_id = $1"];
    const params = [uid];

    if (unread === "true") {
      conditions.push("NOT is_read");
    }

    if (since) {
      const parsed = new Date(since);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid 'since' timestamp" });
      }
      params.push(parsed.toISOString());
      conditions.push(`created_at > $${params.length}`);
    }

    const parsedLimit = Number(limit);
    const safeLimit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, MAX_LIMIT) : DEFAULT_LIMIT;
    params.push(safeLimit);

    const result = await pool.query(
      `SELECT id, type, title, message, related_id, related_type, is_read, created_at, read_at
       FROM notifications
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC, id DESC
       LIMIT $${params.length}`,
      params
    );

    return res.json({
      success: true,
      count: result.rows.length,
      data: result.rows.map(mapNotification),
    });
  } catch (error) {
    console.error("List notifications error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /api/notifications/unread-count
// Drives the header bell badge. latest_created_at lets the client poll cheaply:
// it only fetches the notification list when that value moved forward.
router.get("/unread-count", async (req, res) => {
  try {
    const uid = req.user.userId;

    const result = await pool.query(
      `SELECT COUNT(*)::int AS count, MAX(created_at) AS latest_created_at
       FROM notifications
       WHERE recipient_id = $1 AND NOT is_read`,
      [uid]
    );

    return res.json({
      success: true,
      count: result.rows[0].count,
      latestCreatedAt: result.rows[0].latest_created_at,
    });
  } catch (error) {
    console.error("Unread notification count error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// PATCH /api/notifications/:id/read
// recipient_id is part of the WHERE clause, so a user cannot mark someone
// else's notification as read (it simply matches no row → 404).
router.patch("/:id/read", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE notifications
       SET is_read = true,
           read_at = COALESCE(read_at, NOW())
       WHERE id = $1 AND recipient_id = $2
       RETURNING id, type, title, message, related_id, related_type, is_read, created_at, read_at`,
      [id, uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    const unread = await pool.query(
      `SELECT COUNT(*)::int AS count FROM notifications WHERE recipient_id = $1 AND NOT is_read`,
      [uid]
    );

    return res.json({
      success: true,
      message: "Notification marked as read",
      data: mapNotification(result.rows[0]),
      unreadCount: unread.rows[0].count,
    });
  } catch (error) {
    console.error("Mark notification read error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// PATCH /api/notifications/read-all
router.patch("/read-all", async (req, res) => {
  try {
    const uid = req.user.userId;

    const result = await pool.query(
      `UPDATE notifications
       SET is_read = true,
           read_at = COALESCE(read_at, NOW())
       WHERE recipient_id = $1 AND NOT is_read
       RETURNING id`,
      [uid]
    );

    return res.json({
      success: true,
      message: "All notifications marked as read",
      updated: result.rows.length,
      unreadCount: 0,
    });
  } catch (error) {
    console.error("Mark all notifications read error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// DELETE /api/notifications/:id
// Only the recipient can remove their own notification.
router.delete("/:id", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM notifications
       WHERE id = $1 AND recipient_id = $2
       RETURNING id`,
      [id, uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    const unread = await pool.query(
      `SELECT COUNT(*)::int AS count FROM notifications WHERE recipient_id = $1 AND NOT is_read`,
      [uid]
    );

    return res.json({
      success: true,
      message: "Notification deleted",
      unreadCount: unread.rows[0].count,
    });
  } catch (error) {
    console.error("Delete notification error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
