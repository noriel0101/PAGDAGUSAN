-- A tenant may submit several reservations, but only one can become active.

CREATE UNIQUE INDEX IF NOT EXISTS one_active_lease_per_tenant
  ON leases (tenant_id)
  WHERE status = 'active';
