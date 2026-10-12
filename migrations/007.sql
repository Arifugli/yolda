DROP INDEX IF EXISTS reservation_active_idx;
CREATE UNIQUE INDEX reservation_active_idx ON reservations(compartment_id) WHERE status IN ('reserved','deposited','storage_expired');
