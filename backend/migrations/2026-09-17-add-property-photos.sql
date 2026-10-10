-- Migration: Add property_photos table for multiple property photos
-- Each property can have multiple photos; one is marked as primary.
-- ON DELETE CASCADE: removing a property automatically removes its photos.

CREATE TABLE IF NOT EXISTS property_photos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  photo_url  TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_photos_property_id
  ON property_photos (property_id);

-- Only one photo can be primary per property (partial unique index).
-- This index allows at most one true row per property.
CREATE UNIQUE INDEX IF NOT EXISTS idx_property_photos_one_primary
  ON property_photos (property_id)
  WHERE is_primary = true;