-- The app uses its own HttpOnly sessions and server-side PostgreSQL access.
-- Supabase anon/authenticated clients must never read the app's tables directly.
DO $$
DECLARE
  table_name text;
  client_role text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users','sessions','otp','identity_verifications','shipments','parcels','locations',
    'delivery_legs','courier_offers','assignments','handover_codes','handovers','tracking_events',
    'payments','refunds','payouts','reviews','disputes','conversations','messages','lockers',
    'compartments','reservations','device_events','notifications','audit_logs','idempotency',
    'files','reports','settings','schema_migrations','rate_limits','routes','point_requests',
    'service_vehicles','service_requests','service_offers','service_start_codes',
    'service_events','service_messages','service_reviews'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);
    FOREACH client_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=client_role) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, client_role);
      END IF;
    END LOOP;
  END LOOP;
END $$;
