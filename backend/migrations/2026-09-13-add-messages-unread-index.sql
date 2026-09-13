-- Migration: Add partial index for messages unread-count lookups.
-- Why: GET /api/messages/unread-count scans WHERE receiver_id = $1 AND NOT is_read.
-- The existing messages_receiver_idx covers receiver lookups, but a partial index
-- on (receiver_id) WHERE NOT is_read keeps unread counting fast as conversations
-- grow. No duplicate index is created: this is a distinct, narrower partial index.
-- Idempotent: safe to re-run; preserves existing messages data.

CREATE INDEX IF NOT EXISTS messages_unread_idx
  ON public.messages (receiver_id)
  WHERE NOT is_read;