-- Migration: Add the ratings table.
-- Why: Owners rate tenants and tenants rate dorm owners. Browse/search then
-- ranks dorms by how many five-star ratings the owner has received.
-- Idempotent: safe to re-run; never drops or rewrites existing rows.

CREATE TABLE IF NOT EXISTS ratings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rater_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ratee_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars       INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ratings_no_self CHECK (rater_id <> ratee_id),
  CONSTRAINT ratings_unique_pair UNIQUE (rater_id, ratee_id)
);

-- Summary and browse ranking look up every rating a user has received.
CREATE INDEX IF NOT EXISTS ratings_ratee_idx
  ON public.ratings (ratee_id);

-- Browse ranking is "most five-star ratings first"; a partial index keeps that count cheap.
CREATE INDEX IF NOT EXISTS ratings_ratee_five_star_idx
  ON public.ratings (ratee_id)
  WHERE stars = 5;

CREATE INDEX IF NOT EXISTS ratings_rater_idx
  ON public.ratings (rater_id);
