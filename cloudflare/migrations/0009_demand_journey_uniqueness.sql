-- Remove duplicate active DEMAND signals for the same
-- passenger + route + origin + destination.
--
-- Keep the oldest signal and cancel newer duplicates.
UPDATE demand_signals
SET
    status = 'CANCELLED',
    updated_at = strftime('%s','now') * 1000
WHERE signal_type = 'DEMAND'
  AND status = 'ACTIVE'
  AND origin_point_id IS NOT NULL
  AND destination_point_id IS NOT NULL
  AND id NOT IN (
      SELECT MIN(id)
      FROM demand_signals
      WHERE signal_type = 'DEMAND'
        AND status = 'ACTIVE'
        AND origin_point_id IS NOT NULL
        AND destination_point_id IS NOT NULL
      GROUP BY
          passenger_id,
          route_id,
          origin_point_id,
          destination_point_id
  );

-- A passenger can have only one active DEMAND signal
-- for a specific route journey.
CREATE UNIQUE INDEX IF NOT EXISTS
  idx_demand_signals_active_demand_journey_unique
ON demand_signals(
    passenger_id,
    route_id,
    origin_point_id,
    destination_point_id
)
WHERE signal_type = 'DEMAND'
  AND status = 'ACTIVE'
  AND origin_point_id IS NOT NULL
  AND destination_point_id IS NOT NULL;
