CREATE TABLE bookings (
 id TEXT PRIMARY KEY,
 service_id TEXT NOT NULL,
 resource_id TEXT NOT NULL,
 starts_at TEXT NOT NULL,
 ends_at TEXT NOT NULL,
 customer_name TEXT NOT NULL,
 customer_email TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','cancelled','completed')),
 token_hash TEXT NOT NULL,
 request_key TEXT NOT NULL UNIQUE,
 request_hash TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 CHECK (ends_at > starts_at)
);
--> statement-breakpoint
CREATE INDEX bookings_resource_time ON bookings(resource_id, starts_at, ends_at);
--> statement-breakpoint
CREATE TRIGGER prevent_booking_overlap_insert BEFORE INSERT ON bookings
WHEN NEW.status != 'cancelled' AND EXISTS (
 SELECT 1 FROM bookings WHERE resource_id = NEW.resource_id AND status != 'cancelled'
 AND starts_at < NEW.ends_at AND ends_at > NEW.starts_at
)
BEGIN SELECT RAISE(ABORT, 'slot_conflict'); END;
--> statement-breakpoint
CREATE TRIGGER prevent_booking_overlap_update BEFORE UPDATE OF starts_at, ends_at, resource_id, status ON bookings
WHEN NEW.status != 'cancelled' AND EXISTS (
 SELECT 1 FROM bookings WHERE id != NEW.id AND resource_id = NEW.resource_id AND status != 'cancelled'
 AND starts_at < NEW.ends_at AND ends_at > NEW.starts_at
)
BEGIN SELECT RAISE(ABORT, 'slot_conflict'); END;
--> statement-breakpoint
CREATE TABLE admin_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
