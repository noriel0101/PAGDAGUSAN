CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK (role IN ('admin','owner','tenant')), avatar TEXT NOT NULL DEFAULT '', phone TEXT,
 property_assigned TEXT, room_number TEXT, joined_date DATE NOT NULL DEFAULT CURRENT_DATE,
 status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','suspended'))
);
CREATE TABLE IF NOT EXISTS rooms (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, room_number TEXT NOT NULL, property_name TEXT NOT NULL, address TEXT NOT NULL,
 city TEXT NOT NULL, price_monthly NUMERIC(12,2) NOT NULL CHECK (price_monthly >= 0), deposit_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
 capacity INTEGER NOT NULL CHECK (capacity > 0), occupied_count INTEGER NOT NULL DEFAULT 0 CHECK (occupied_count >= 0),
 status TEXT NOT NULL CHECK (status IN ('available','full','maintenance','reserved')), room_type TEXT NOT NULL,
 gender_preference TEXT NOT NULL, amenities TEXT[] NOT NULL DEFAULT '{}', photos TEXT[] NOT NULL DEFAULT '{}', description TEXT NOT NULL,
 rating NUMERIC(3,1) NOT NULL DEFAULT 0, reviews_count INTEGER NOT NULL DEFAULT 0, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), featured BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS leases (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
 start_date DATE NOT NULL, end_date DATE NOT NULL, monthly_rent NUMERIC(12,2) NOT NULL, deposit_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
 status TEXT NOT NULL CHECK (status IN ('active','pending_approval','expired','terminated')),
 emergency_contact_name TEXT NOT NULL, emergency_contact_relationship TEXT NOT NULL, emergency_contact_phone TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
 id TEXT PRIMARY KEY, invoice_no TEXT UNIQUE NOT NULL, tenant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 room_number TEXT NOT NULL, property_name TEXT NOT NULL, amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0), month_covered TEXT NOT NULL,
 due_date DATE NOT NULL, paid_date DATE, payment_method TEXT NOT NULL, proof_image_url TEXT, reference_number TEXT,
 status TEXT NOT NULL CHECK (status IN ('paid','pending','overdue','rejected')), notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS maintenance_requests (
 id TEXT PRIMARY KEY, ticket_no TEXT UNIQUE NOT NULL, tenant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT, category TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
 priority TEXT NOT NULL CHECK (priority IN ('low','medium','high','urgent')), status TEXT NOT NULL CHECK (status IN ('pending','reviewing','in_progress','completed','cancelled')),
 photos TEXT[] NOT NULL DEFAULT '{}', submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 assigned_staff TEXT, resolution_notes TEXT, scheduled_date DATE
);
CREATE TABLE IF NOT EXISTS announcements (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, type TEXT NOT NULL, audience TEXT NOT NULL,
 property_name TEXT, author_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), pinned BOOLEAN NOT NULL DEFAULT FALSE, likes_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS messages (
 id TEXT PRIMARY KEY, sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 content TEXT NOT NULL, sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), read BOOLEAN NOT NULL DEFAULT FALSE, attachment_url TEXT
);
CREATE TABLE IF NOT EXISTS audit_logs (
 id TEXT PRIMARY KEY, timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(), action TEXT NOT NULL, actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 details TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('success','warning','info','danger'))
);
CREATE INDEX IF NOT EXISTS rooms_owner_idx ON rooms(owner_id); CREATE INDEX IF NOT EXISTS leases_tenant_idx ON leases(tenant_id);
CREATE INDEX IF NOT EXISTS payments_tenant_idx ON payments(tenant_id); CREATE INDEX IF NOT EXISTS maintenance_tenant_idx ON maintenance_requests(tenant_id);
CREATE INDEX IF NOT EXISTS messages_participants_idx ON messages(sender_id, recipient_id);
