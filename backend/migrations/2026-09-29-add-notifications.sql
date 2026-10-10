-- Migration: Add the notifications table.
-- Why: PAGDAGUSAN needs database-backed notifications so the backend can push a
-- row to the correct recipient whenever a real business event happens
-- (reservation requested/approved/rejected, payment submitted/verified/rejected,
-- maintenance created/updated, message received, announcement published,
-- owner registered/approved/rejected).
-- No duplicate table is created: the whole migration is guarded by IF NOT EXISTS,
-- so re-running it on a database that already has `notifications` is a no-op.
-- Idempotent: safe to re-run; never drops or rewrites existing rows.

CREATE TABLE IF NOT EXISTS notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          VARCHAR(60) NOT NULL,
  title         VARCHAR(200) NOT NULL,
  message       TEXT NOT NULL,
  related_id    UUID,
  related_type  VARCHAR(60),
  is_read       BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at       TIMESTAMPTZ
);

-- Every notification endpoint is scoped by recipient and ordered newest first
-- (GET /api/notifications, GET /api/notifications/unread-count).
CREATE INDEX IF NOT EXISTS notifications_recipient_created_idx
  ON public.notifications (recipient_id, created_at DESC);

-- The bell badge counts only unread rows for the signed-in user. A partial
-- index keeps that count O(unread) instead of scanning the recipient's history.
CREATE INDEX IF NOT EXISTS notifications_recipient_unread_idx
  ON public.notifications (recipient_id)
  WHERE NOT is_read;
