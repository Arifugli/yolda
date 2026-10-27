-- Preserve IDs/FKs and existing orders; the compatibility view has no copied data.
ALTER TABLE service_requests RENAME TO orders;
ALTER TABLE orders DROP CONSTRAINT service_requests_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK(status IN ('created','published','driver_pending','assigned','en_route_to_pickup','arrived','in_progress','awaiting_confirmation','completed','cancelled'));
ALTER TABLE orders ADD COLUMN engine_version integer NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN payment_method text NOT NULL DEFAULT 'demo' CHECK(payment_method IN ('demo','cash','card'));
ALTER TABLE orders ADD COLUMN price_snapshot jsonb;
ALTER TABLE orders ADD COLUMN cancellation_reason text;
ALTER TABLE orders ADD COLUMN service_type text GENERATED ALWAYS AS (CASE kind WHEN 'taxi' THEN 'ride' WHEN 'cargo' THEN 'freight' ELSE kind END) STORED;
ALTER TABLE orders ADD COLUMN state text GENERATED ALWAYS AS (CASE status WHEN 'published' THEN 'searching' WHEN 'driver_pending' THEN 'offered' WHEN 'assigned' THEN 'accepted' WHEN 'awaiting_confirmation' THEN 'in_progress' ELSE status END) STORED;
CREATE VIEW service_requests WITH (security_invoker=true) AS SELECT * FROM orders;
REVOKE ALL ON orders,service_requests FROM PUBLIC;
CREATE TABLE order_events (
  id bigserial PRIMARY KEY, order_id uuid NOT NULL REFERENCES orders ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users, from_state text, to_state text NOT NULL,
  detail text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order_idx ON order_events(order_id,id);
CREATE TABLE order_tariffs (
  service_type text NOT NULL, code text NOT NULL, version integer NOT NULL CHECK(version>0),
  rules jsonb NOT NULL, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(service_type,code,version)
);
CREATE UNIQUE INDEX order_tariffs_active_idx ON order_tariffs(service_type,code) WHERE active;
INSERT INTO order_tariffs(service_type,code,version,rules) VALUES
('ride','economy',1,'{"base":7000,"perKm":2500,"minimum":10000,"roundTo":1000,"maxKm":150}');
ALTER TABLE order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_tariffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON order_events,order_tariffs FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON orders,service_requests,order_events,order_tariffs FROM %I',r);
    END IF;
  END LOOP;
END $$;
ALTER TABLE otp ADD COLUMN provider text NOT NULL DEFAULT 'demo';
