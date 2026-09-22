PRAGMA foreign_keys = ON;

-- TaxiConnect transport heartbeat.
-- Keeps operational state separate from trip lifecycle so a taxi can be
-- AT_RANK, ROAMING, RETURNING or FULL without inventing fake GPS/ETA data.
ALTER TABLE trips
  ADD COLUMN operational_state TEXT NOT NULL DEFAULT 'AT_RANK'
  CHECK (operational_state IN (
    'OPERATING',
    'ROAMING',
    'AT_RANK',
    'RETURNING',
    'FULL',
    'OFF_DUTY'
  ));

ALTER TABLE trips
  ADD COLUMN operational_updated_at INTEGER;

UPDATE trips
SET operational_state = CASE
  WHEN status = 'FULL' THEN 'FULL'
  WHEN status = 'DEPARTED' THEN 'RETURNING'
  WHEN status = 'COLLECTING' THEN 'ROAMING'
  WHEN status = 'LOADING' THEN 'AT_RANK'
  ELSE 'OFF_DUTY'
END,
operational_updated_at = COALESCE(last_updated, started_at, strftime('%s','now') * 1000)
WHERE operational_updated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_trips_route_operational_state
  ON trips(route_id, operational_state, operational_updated_at);

CREATE INDEX IF NOT EXISTS idx_trips_taxi_operational_state
  ON trips(taxi_id, operational_state, operational_updated_at);
