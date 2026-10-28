ALTER TABLE orders DROP CONSTRAINT service_requests_kind_check;
ALTER TABLE orders ADD CONSTRAINT orders_kind_check CHECK(kind IN ('taxi','cargo','equipment','delivery'));
-- Delivery couriers need no registered taxi vehicle.
ALTER TABLE orders DROP CONSTRAINT service_requests_check1;
ALTER TABLE orders ADD CONSTRAINT orders_assignment_check CHECK(
 (provider_id IS NULL AND vehicle_id IS NULL AND agreed_price IS NULL) OR
 (provider_id IS NOT NULL AND agreed_price IS NOT NULL AND (vehicle_id IS NOT NULL OR kind='delivery'))
);
ALTER TABLE orders ADD COLUMN shipment_id uuid UNIQUE REFERENCES shipments ON DELETE CASCADE;
ALTER TABLE taxi_presence RENAME TO executor_presence;
ALTER TABLE executor_presence DROP CONSTRAINT taxi_presence_pkey;
ALTER TABLE executor_presence ALTER COLUMN vehicle_id DROP NOT NULL;
ALTER TABLE executor_presence ADD COLUMN service_type text NOT NULL DEFAULT 'ride' CHECK(service_type IN ('ride','delivery'));
ALTER TABLE executor_presence ADD COLUMN transport text NOT NULL DEFAULT 'car' CHECK(transport IN ('walk','bike','scooter','car'));
ALTER TABLE executor_presence ADD PRIMARY KEY(user_id,service_type);
CREATE VIEW taxi_presence WITH(security_invoker=true) AS SELECT user_id,vehicle_id,lat,lng,accuracy,updated_at FROM executor_presence WHERE service_type='ride';
ALTER TABLE taxi_dispatches RENAME TO order_dispatches;
ALTER TABLE order_dispatches ALTER COLUMN vehicle_id DROP NOT NULL;
CREATE VIEW taxi_dispatches WITH(security_invoker=true) AS SELECT * FROM order_dispatches;
REVOKE ALL ON executor_presence,taxi_presence,order_dispatches,taxi_dispatches FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON executor_presence,taxi_presence,order_dispatches,taxi_dispatches FROM %I',r);
  END IF;
 END LOOP;
END $$;
