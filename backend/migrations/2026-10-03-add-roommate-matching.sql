-- Roommate matching.
-- A tenant can attach roommate preferences to a reservation (lease).
-- Other tenants store their own habits so browse can say whether they match.
-- Idempotent: safe to re-run; never drops existing rows.

CREATE TABLE IF NOT EXISTS roommate_preferences (
  lease_id            UUID PRIMARY KEY REFERENCES leases(id) ON DELETE CASCADE,
  wants_non_smoker    BOOLEAN NOT NULL DEFAULT false,
  wants_non_drinker   BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_lifestyles (
  tenant_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  is_non_smoker   BOOLEAN NOT NULL DEFAULT false,
  is_non_drinker  BOOLEAN NOT NULL DEFAULT false,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
