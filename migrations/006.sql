ALTER TABLE idempotency ADD COLUMN IF NOT EXISTS request_hash text;
-- Expired demo replay entries containing an unencrypted response are removed.
-- Unique financial and assignment constraints still prevent duplicate operations.
DELETE FROM idempotency WHERE response->>'v' IS NULL;
UPDATE settings SET data=jsonb_set(data,'{zones}','{"Фергана":{"lat":40.386,"lng":71.786,"radiusKm":25},"Коканд":{"lat":40.528,"lng":70.942,"radiusKm":25},"Андижан":{"lat":40.782,"lng":72.344,"radiusKm":25},"Наманган":{"lat":40.998,"lng":71.672,"radiusKm":25}}') WHERE NOT(data ? 'zones');
ALTER TABLE lockers ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE lockers ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE lockers ADD COLUMN IF NOT EXISTS lng double precision;
UPDATE lockers SET address='Демонстрационная точка · '||name,lat=CASE city WHEN 'Фергана' THEN 40.386 WHEN 'Коканд' THEN 40.528 WHEN 'Андижан' THEN 40.782 ELSE 40.998 END,lng=CASE city WHEN 'Фергана' THEN 71.786 WHEN 'Коканд' THEN 70.942 WHEN 'Андижан' THEN 72.344 ELSE 71.672 END WHERE lat IS NULL;
