-- Extend presence without changing existing orders or legacy compatibility views.
ALTER TABLE executor_presence DROP CONSTRAINT executor_presence_service_type_check;
ALTER TABLE executor_presence ADD CONSTRAINT executor_presence_service_type_check CHECK(service_type IN ('ride','delivery','freight','equipment'));
-- Demo tariffs in UZS; fixed totals for the requested route/duration, not metered billing.
INSERT INTO order_tariffs(service_type,code,version,rules) VALUES
('freight','van',1,'{"base":50000,"perKm":5000,"perHour":0,"minimum":60000,"roundTo":1000,"maxKm":150}'),
('freight','truck',1,'{"base":100000,"perKm":8000,"perHour":0,"minimum":120000,"roundTo":1000,"maxKm":150}'),
('freight','dump_truck',1,'{"base":150000,"perKm":10000,"perHour":0,"minimum":180000,"roundTo":1000,"maxKm":150}'),
('freight','semi_trailer',1,'{"base":250000,"perKm":15000,"perHour":0,"minimum":300000,"roundTo":1000,"maxKm":150}'),
('equipment','crane',1,'{"base":100000,"perKm":0,"perHour":200000,"minimum":300000,"roundTo":1000,"maxKm":150}'),
('equipment','excavator',1,'{"base":100000,"perKm":0,"perHour":180000,"minimum":280000,"roundTo":1000,"maxKm":150}'),
('equipment','loader',1,'{"base":80000,"perKm":0,"perHour":120000,"minimum":200000,"roundTo":1000,"maxKm":150}'),
('equipment','dump_truck',1,'{"base":100000,"perKm":0,"perHour":150000,"minimum":250000,"roundTo":1000,"maxKm":150}');
