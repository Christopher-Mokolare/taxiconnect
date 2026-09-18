-- TaxiConnect 0008
-- Journey-aware uniqueness for bidirectional passenger requests.
--
-- A passenger may have separate active journeys on the same route:
--
--   Mabeskraal -> Rustenburg
--   Rustenburg -> Mabeskraal
--   Village A -> Rustenburg
--
-- Therefore passenger + route alone is no longer sufficient.
--
-- Existing legacy rows with NULL journey points are retained.
-- New application requests will require origin_point_id and
-- destination_point_id.

DROP INDEX IF EXISTS idx_route_waiting_passenger_route_active_unique;

DROP INDEX IF EXISTS idx_demand_signals_active_waiting_unique;

CREATE UNIQUE INDEX IF NOT EXISTS
  idx_route_waiting_passenger_journey_active_unique
ON route_waiting_passengers(
  passenger_id,
  route_id,
  origin_point_id,
  destination_point_id
)
WHERE status = 'WAITING'
  AND origin_point_id IS NOT NULL
  AND destination_point_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS
  idx_demand_signals_active_waiting_journey_unique
ON demand_signals(
  passenger_id,
  route_id,
  origin_point_id,
  destination_point_id
)
WHERE signal_type = 'WAITING'
  AND status = 'ACTIVE'
  AND origin_point_id IS NOT NULL
  AND destination_point_id IS NOT NULL;
