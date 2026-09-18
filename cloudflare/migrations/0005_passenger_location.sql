ALTER TABLE route_waiting_passengers
ADD COLUMN request_mode TEXT NOT NULL DEFAULT 'COLLECTION'
CHECK (request_mode IN ('RANK', 'ALONG_ROUTE', 'COLLECTION'));

ALTER TABLE route_waiting_passengers
ADD COLUMN latitude REAL;

ALTER TABLE route_waiting_passengers
ADD COLUMN longitude REAL;

ALTER TABLE route_waiting_passengers
ADD COLUMN pickup_description TEXT;

ALTER TABLE demand_signals
ADD COLUMN request_mode TEXT NOT NULL DEFAULT 'COLLECTION'
CHECK (request_mode IN ('RANK', 'ALONG_ROUTE', 'COLLECTION'));

ALTER TABLE demand_signals
ADD COLUMN latitude REAL;

ALTER TABLE demand_signals
ADD COLUMN longitude REAL;

ALTER TABLE demand_signals
ADD COLUMN pickup_description TEXT;
