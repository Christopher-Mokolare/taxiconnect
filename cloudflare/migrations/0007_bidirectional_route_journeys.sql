-- TaxiConnect 0007
-- Bidirectional route journeys.
--
-- A route represents a transport corridor/service.
-- A passenger journey explicitly selects:
--
--   origin_point_id -> destination_point_id
--
-- Pickup location remains separate because a passenger may board
-- at a rank, an intermediate pickup point, or an approximate
-- location along the route.
--
-- Existing routes.origin / routes.destination are retained temporarily
-- for backward compatibility and display purposes. They are NOT the
-- authoritative direction of a passenger journey.

ALTER TABLE route_pickup_points
ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0;

ALTER TABLE route_waiting_passengers
ADD COLUMN origin_point_id TEXT;

ALTER TABLE route_waiting_passengers
ADD COLUMN destination_point_id TEXT;

ALTER TABLE demand_signals
ADD COLUMN origin_point_id TEXT;

ALTER TABLE demand_signals
ADD COLUMN destination_point_id TEXT;

ALTER TABLE trips
ADD COLUMN origin_point_id TEXT;

ALTER TABLE trips
ADD COLUMN destination_point_id TEXT;

CREATE INDEX IF NOT EXISTS idx_route_pickup_points_route_sequence
ON route_pickup_points(route_id, sequence);

CREATE INDEX IF NOT EXISTS idx_route_waiting_journey
ON route_waiting_passengers(route_id, origin_point_id, destination_point_id);

CREATE INDEX IF NOT EXISTS idx_demand_signals_journey
ON demand_signals(route_id, origin_point_id, destination_point_id);

CREATE INDEX IF NOT EXISTS idx_trips_journey
ON trips(route_id, origin_point_id, destination_point_id);
