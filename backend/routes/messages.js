const express = require("express");
const pool = require("../db");
const requireAuth = require("../middleware/auth");
const requireRole = require("../middleware/role");

const router = express.Router();

router.use(requireAuth);
router.use(requireRole("owner", "tenant"));

const MAX_MESSAGE_LENGTH = 2000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A legitimate conversation exists only between a tenant and the owner of the
// property the tenant currently rents (via lease → room → property → owner).
// Both sides of the pair are checked so owners can only talk to their own
// tenants and tenants can only talk to their current property owner.
async function findRelationship(uid, targetId) {
  const result = await pool.query(
    `SELECT t.id AS tenant_id, o.id AS owner_id,
            t.name AS tenant_name, o.name AS owner_name
     FROM users t
     JOIN tenant_current_room v ON v.tenant_id = t.id
     JOIN properties p ON p.id = v.property_id
     JOIN users o ON o.id = p.owner_id
     WHERE t.role = 'tenant' AND o.role = 'owner'
       AND ((t.id = $1 AND o.id = $2) OR (t.id = $2 AND o.id = $1))
     LIMIT 1`,
    [uid, targetId]
  );
  return result.rows.length ? result.rows[0] : null;
}

// Users the authenticated user may hold a conversation with, derived from the
// database relationships only (never from client-supplied ids).
async function allowedParticipants(uid) {
  const result = await pool.query(
    `SELECT DISTINCT counterpart.id, counterpart.name, counterpart.role
     FROM (
       -- tenants of the properties owned by uid (owner side)
       SELECT v.tenant_id AS id
       FROM tenant_current_room v
       JOIN properties p ON p.id = v.property_id
       WHERE p.owner_id = $1
       UNION
       -- owner of the property uid currently rents (tenant side)
       SELECT p.owner_id AS id
       FROM tenant_current_room v
       JOIN properties p ON p.id = v.property_id
       WHERE v.tenant_id = $1
     ) rel
     JOIN users counterpart ON counterpart.id = rel.id`,
    [uid]
  );
  return result.rows;
}

function mapThreadMessage(m) {
  return {
    id: m.id,
    content: m.content,
    isRead: m.is_read,
    senderId: m.sender_id,
    receiverId: m.receiver_id,
    createdAt: m.created_at,
  };
}

// ─── Conversation list ────────────────────────────────────
// Groups existing messages by the other participant and only keeps
// relationships that are legitimate according to the database.
router.get("/conversations", async (req, res) => {
  try {
    const uid = req.user.userId;

    const result = await pool.query(
      `SELECT m.id, m.content, m.is_read, m.created_at,
              m.sender_id, m.receiver_id,
              counterpart.id AS counterpart_id,
              counterpart.name AS counterpart_name,
              counterpart.role AS counterpart_role
       FROM messages m
       JOIN users counterpart
         ON counterpart.id = CASE WHEN m.sender_id = $1 THEN m.receiver_id
                                  ELSE m.sender_id END
       WHERE m.sender_id = $1 OR m.receiver_id = $1
       ORDER BY m.created_at DESC`,
      [uid]
    );

    const allowed = new Map(
      (await allowedParticipants(uid)).map((u) => [u.id, u])
    );

    const conversationMap = new Map();
    for (const m of result.rows) {
      if (!allowed.has(m.counterpart_id)) continue;
      if (!conversationMap.has(m.counterpart_id)) {
        const profile = allowed.get(m.counterpart_id);
        conversationMap.set(m.counterpart_id, {
          counterpartId: profile.id,
          counterpartName: profile.name,
          counterpartRole: profile.role,
          unreadCount: 0,
          lastMessage: null,
        });
      }
      const conv = conversationMap.get(m.counterpart_id);
      if (!conv.lastMessage) {
        conv.lastMessage = {
          id: m.id,
          content: m.content,
          isRead: m.is_read,
          senderId: m.sender_id,
          createdAt: m.created_at,
        };
      }
      if (m.sender_id !== uid && !m.is_read) {
        conv.unreadCount++;
      }
    }

    const conversations = [...conversationMap.values()].sort(
      (a, b) =>
        new Date((b.lastMessage && b.lastMessage.createdAt) || 0).getTime() -
        new Date((a.lastMessage && a.lastMessage.createdAt) || 0).getTime()
    );

    return res.json({ success: true, data: conversations });
  } catch (error) {
    console.error("Get conversations error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── Conversation thread with a participant ───────────────
// Only accessible when a legitimate owner/tenant relationship exists.
// Marks incoming messages as read.
router.get("/conversations/:userId", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { userId } = req.params;

    if (!UUID_RE.test(userId)) {
      return res.status(400).json({ success: false, message: "Invalid user id" });
    }
    if (userId === uid) {
      return res
        .status(403)
        .json({ success: false, message: "You cannot open a conversation with yourself" });
    }

    // 1. Target user must exist and be an owner or tenant.
    const profile = await pool.query(
      `SELECT id, name, role FROM users WHERE id = $1`,
      [userId]
    );
    if (profile.rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    if (!["owner", "tenant"].includes(profile.rows[0].role)) {
      return res
        .status(403)
        .json({ success: false, message: "You are not authorized to access this conversation" });
    }

    // 2. A legitimate owner/tenant relationship must exist.
    const relationship = await findRelationship(uid, userId);
    if (!relationship) {
      return res
        .status(403)
        .json({ success: false, message: "You are not authorized to access this conversation" });
    }

    const threadResult = await pool.query(
      `SELECT id, content, is_read, created_at, sender_id, receiver_id
       FROM messages
       WHERE (sender_id = $1 AND receiver_id = $2)
          OR (sender_id = $2 AND receiver_id = $1)
       ORDER BY created_at ASC`,
      [uid, userId]
    );

    // Opening the conversation marks the counterpart's incoming messages as read.
    await pool.query(
      `UPDATE messages SET is_read = true
       WHERE sender_id = $1 AND receiver_id = $2 AND NOT is_read`,
      [userId, uid]
    );

    return res.json({
      success: true,
      data: {
        user: {
          id: profile.rows[0].id,
          name: profile.rows[0].name,
          role: profile.rows[0].role,
        },
        messages: threadResult.rows.map(mapThreadMessage),
      },
    });
  } catch (error) {
    console.error("Get conversation error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── Send a message ───────────────────────────────────────
// The sender is always req.user.userId. senderId/propertyId supplied by the
// client are ignored. The receiver must have a legitimate owner/tenant
// relationship with the sender.
router.post("/", async (req, res) => {
  try {
    const senderId = req.user.userId;
    const { receiverId, message } = req.body;

    if (typeof receiverId !== "string" || !UUID_RE.test(receiverId)) {
      return res.status(400).json({ success: false, message: "A valid receiver is required" });
    }
    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ success: false, message: "Message content is required" });
    }
    if (message.trim().length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ success: false, message: "Message is too long" });
    }
    if (receiverId === senderId) {
      return res.status(400).json({ success: false, message: "You cannot message yourself" });
    }

    const receiverResult = await pool.query(
      `SELECT id, role, name FROM users WHERE id = $1`,
      [receiverId]
    );
    if (receiverResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Receiver not found" });
    }
    if (!["owner", "tenant"].includes(receiverResult.rows[0].role)) {
      return res
        .status(403)
        .json({ success: false, message: "You are not authorized to message this user" });
    }

    const relationship = await findRelationship(senderId, receiverId);
    if (!relationship) {
      return res
        .status(403)
        .json({ success: false, message: "You are not authorized to message this user" });
    }

    const result = await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, content, is_read, created_at, sender_id, receiver_id`,
      [senderId, receiverId, message.trim()]
    );

    return res.status(201).json({
      success: true,
      message: "Message sent",
      data: mapThreadMessage(result.rows[0]),
    });
  } catch (error) {
    console.error("Send message error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── Mark a message as read ───────────────────────────────
// Only the receiver of the message may mark it read.
//  - message does not exist          → 404
//  - requester is the receiver       → 200 (marks read)
//  - requester is the sender         → 403 (participant, but not allowed)
//  - requester is not a participant  → 404 (do not reveal message existence)
router.patch("/:id/read", async (req, res) => {
  try {
    const uid = req.user.userId;
    const { id } = req.params;

    if (!UUID_RE.test(id)) {
      return res.status(400).json({ success: false, message: "Invalid message id" });
    }

    const existing = await pool.query(
      `SELECT id, sender_id, receiver_id FROM messages WHERE id = $1`,
      [id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Message not found" });
    }

    const msg = existing.rows[0];
    if (msg.receiver_id !== uid) {
      // Only the receiver may toggle read state. The sender is told clearly;
      // unrelated users get 404 so message existence is not leaked.
      if (msg.sender_id === uid) {
        return res
          .status(403)
          .json({ success: false, message: "Only the receiver can mark a message as read" });
      }
      return res.status(404).json({ success: false, message: "Message not found" });
    }

    await pool.query(
      `UPDATE messages SET is_read = true WHERE id = $1`,
      [id]
    );

    return res.json({
      success: true,
      message: "Message marked as read",
      data: { id },
    });
  } catch (error) {
    console.error("Mark message read error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── Unread count for the authenticated user ──────────────
router.get("/unread-count", async (req, res) => {
  try {
    const uid = req.user.userId;

    const result = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM messages
       WHERE receiver_id = $1 AND NOT is_read`,
      [uid]
    );

    return res.json({ success: true, data: { unreadCount: result.rows[0].count } });
  } catch (error) {
    console.error("Get unread count error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;