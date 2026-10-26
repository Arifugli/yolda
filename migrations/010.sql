ALTER TABLE service_requests DROP CONSTRAINT service_requests_status_check;
ALTER TABLE service_requests ADD CONSTRAINT service_requests_status_check CHECK(status IN ('published','driver_pending','assigned','arrived','in_progress','awaiting_confirmation','completed','cancelled'));
CREATE UNIQUE INDEX service_one_active_provider_idx ON service_requests(provider_id) WHERE provider_id IS NOT NULL AND status NOT IN ('completed','cancelled');
CREATE TABLE taxi_presence (
  user_id uuid PRIMARY KEY REFERENCES users, vehicle_id uuid NOT NULL REFERENCES service_vehicles,
  lat double precision NOT NULL CHECK(lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK(lng BETWEEN -180 AND 180),
  accuracy double precision NOT NULL CHECK(accuracy BETWEEN 0 AND 200),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE taxi_dispatches (
  request_id uuid NOT NULL REFERENCES service_requests ON DELETE CASCADE, provider_id uuid NOT NULL REFERENCES users,
  vehicle_id uuid NOT NULL REFERENCES service_vehicles, status text NOT NULL CHECK(status IN ('pending','accepted','rejected','expired')),
  expires_at timestamptz NOT NULL, PRIMARY KEY(request_id,provider_id)
);
CREATE UNIQUE INDEX taxi_one_pending_idx ON taxi_dispatches(request_id) WHERE status='pending';
ALTER TABLE taxi_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE taxi_dispatches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON taxi_presence,taxi_dispatches FROM PUBLIC;
DO $$ DECLARE client_role text; BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=client_role) THEN
      EXECUTE format('REVOKE ALL ON taxi_presence,taxi_dispatches FROM %I',client_role);
    END IF;
  END LOOP;
END $$;
