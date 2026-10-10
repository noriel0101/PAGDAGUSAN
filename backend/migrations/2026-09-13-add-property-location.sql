-- Migration: Add property location columns + range check constraints
-- Why: Dorm owners must save the exact location of their dorm/property so
-- tenants can see it on a map and open it in their device's map application.
-- Location belongs directly on the existing `properties` table (never a
-- separate table). Existing properties keep their data; coordinates are
-- nullable and simply default to NULL when a property has no location yet.
-- Idempotent: safe to re-run on the live PAGDAGUSAN V2 database.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(10,7);

-- Range guards mirror the API validation. NULL values are allowed (a property
-- may not have a location yet), and CHECK constraints ignore NULL rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'properties_latitude_range_check' AND conrelid = 'properties'::regclass
  ) THEN
    ALTER TABLE properties
      ADD CONSTRAINT properties_latitude_range_check
      CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'properties_longitude_range_check' AND conrelid = 'properties'::regclass
  ) THEN
    ALTER TABLE properties
      ADD CONSTRAINT properties_longitude_range_check
      CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180));
  END IF;
END
$$;