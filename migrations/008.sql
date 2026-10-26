CREATE TABLE service_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users,
  kind text NOT NULL CHECK(kind IN ('sedan','minivan','van','truck','dump_truck','semi_trailer','crane','excavator','loader')),
  data jsonb NOT NULL, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_vehicles_owner_idx ON service_vehicles(owner_id);
CREATE TABLE service_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES users,
  provider_id uuid REFERENCES users, vehicle_id uuid REFERENCES service_vehicles,
  kind text NOT NULL CHECK(kind IN ('taxi','cargo','equipment')), data jsonb NOT NULL,
  status text NOT NULL DEFAULT 'published' CHECK(status IN ('published','assigned','arrived','in_progress','awaiting_confirmation','completed','cancelled')),
  agreed_price integer CHECK(agreed_price>0),
  dispute_status text NOT NULL DEFAULT 'none' CHECK(dispute_status IN ('none','open','resolved')),
  dispute_reason text, dispute_resolution text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(provider_id IS NULL OR provider_id<>customer_id),
  CHECK((provider_id IS NULL AND vehicle_id IS NULL AND agreed_price IS NULL) OR (provider_id IS NOT NULL AND vehicle_id IS NOT NULL AND agreed_price IS NOT NULL))
);
CREATE INDEX service_requests_market_idx ON service_requests(kind,status,created_at DESC);
CREATE INDEX service_requests_customer_idx ON service_requests(customer_id);
CREATE INDEX service_requests_provider_idx ON service_requests(provider_id);
CREATE TABLE service_offers (
  request_id uuid NOT NULL REFERENCES service_requests ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES users, vehicle_id uuid NOT NULL REFERENCES service_vehicles,
  price integer NOT NULL CHECK(price>0), comment text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(request_id,provider_id)
);
CREATE TABLE service_start_codes (
  request_id uuid PRIMARY KEY REFERENCES service_requests ON DELETE CASCADE,
  hash text NOT NULL, expires_at timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0,
  used_at timestamptz
);
CREATE TABLE service_events (
  id bigserial PRIMARY KEY, request_id uuid NOT NULL REFERENCES service_requests ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users, status text NOT NULL, detail text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_events_request_idx ON service_events(request_id,id);
CREATE TABLE service_messages (
  id bigserial PRIMARY KEY, request_id uuid NOT NULL REFERENCES service_requests ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users, text text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_messages_request_idx ON service_messages(request_id,id);
CREATE TABLE service_reviews (
  request_id uuid NOT NULL REFERENCES service_requests ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users, target_id uuid NOT NULL REFERENCES users,
  stars integer NOT NULL CHECK(stars BETWEEN 1 AND 5), comment text NOT NULL,
  publish_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
  PRIMARY KEY(request_id,author_id), CHECK(author_id<>target_id)
);
