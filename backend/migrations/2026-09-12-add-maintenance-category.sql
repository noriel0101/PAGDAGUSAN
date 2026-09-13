-- Migration: Add maintenance_category enum + category column
-- Why: maintenance_requests in the live DB has no `category` column, but the
-- original product schema and the PAYMENTS-era API contract both include a
-- maintenance category. This adds it idempotently, defaulting existing rows to
-- 'general'. No duplicate table is created; the existing table is extended.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t WHERE t.typname = 'maintenance_category') THEN
    CREATE TYPE maintenance_category AS ENUM
      ('plumbing', 'electrical', 'appliance', 'furniture', 'structure',
       'internet', 'pest_control', 'cleaning', 'security', 'general', 'other');
  END IF;
END
$$;

ALTER TABLE maintenance_requests
  ADD COLUMN IF NOT EXISTS category maintenance_category NOT NULL DEFAULT 'general';