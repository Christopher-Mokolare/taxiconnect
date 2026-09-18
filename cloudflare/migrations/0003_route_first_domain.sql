PRAGMA foreign_keys = ON;

-- ============================================================
-- TAXICONNECT FINAL ROUTE-FIRST DOMAIN MODEL
--
-- Core principles:
--
-- 1. Passengers do NOT belong to an operator/association.
-- 2. Taxis belong to an operator/association.
-- 3. A taxi can be authorized for MULTIPLE routes.
-- 4. A taxi operates on ONE current route/trip at a time.
-- 5. Daily loading-line position is temporary and date-specific.
-- 6. Route service mode determines passenger behavior.
-- 7. Passenger demand is route-centric.
-- 8. Driver/conductor authorization is server-side.
-- ============================================================


-- ============================================================
-- OPERATORS / ASSOCIATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS operators (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    registration_number TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    active INTEGER NOT NULL DEFAULT 1
        CHECK (active IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operators_registration
    ON operators(registration_number)
    WHERE registration_number IS NOT NULL;


-- ============================================================
-- OPERATOR MEMBERSHIPS
--
-- Users are NOT forced to have operator_id directly.
-- Passengers have no membership.
-- Drivers/conductors/admins can be members of an operator.
-- ============================================================

CREATE TABLE IF NOT EXISTS operator_memberships (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    membership_role TEXT NOT NULL
        CHECK (
            membership_role IN (
                'operator_admin',
                'driver',
                'conductor'
            )
        ),
    active INTEGER NOT NULL DEFAULT 1
        CHECK (active IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    FOREIGN KEY (operator_id)
        REFERENCES operators(id)
        ON DELETE CASCADE,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_membership_unique
    ON operator_memberships(operator_id, user_id, membership_role);

CREATE INDEX IF NOT EXISTS idx_operator_memberships_user
    ON operator_memberships(user_id, active);

CREATE INDEX IF NOT EXISTS idx_operator_memberships_operator
    ON operator_memberships(operator_id, active);


-- ============================================================
-- ROUTES
--
-- Routes are platform entities, not hardcoded Worker constants.
--
-- service_mode:
--   RANK_DEPARTURE
--   COLLECTION
--   HYBRID
-- ============================================================

CREATE TABLE IF NOT EXISTS routes (
    id TEXT PRIMARY KEY,
    origin TEXT NOT NULL,
    destination TEXT NOT NULL,
    name TEXT NOT NULL,
    service_mode TEXT NOT NULL
        CHECK (
            service_mode IN (
                'RANK_DEPARTURE',
                'COLLECTION',
                'HYBRID'
            )
        ),
    active INTEGER NOT NULL DEFAULT 1
        CHECK (active IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_routes_origin_destination
    ON routes(origin, destination);

CREATE INDEX IF NOT EXISTS idx_routes_active
    ON routes(active);


-- ============================================================
-- ROUTE PICKUP POINTS
--
-- Used for COLLECTION/HYBRID routes.
-- Rank-departure routes can have a primary rank location
-- represented through a pickup point with point_type = RANK.
-- ============================================================

CREATE TABLE IF NOT EXISTS route_pickup_points (
    id TEXT PRIMARY KEY,
    route_id TEXT NOT NULL,
    name TEXT NOT NULL,
    point_type TEXT NOT NULL
        CHECK (
            point_type IN (
                'RANK',
                'PICKUP',
                'DROP_OFF'
            )
        ),
    latitude REAL,
    longitude REAL,
    address TEXT,
    active INTEGER NOT NULL DEFAULT 1
        CHECK (active IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    FOREIGN KEY (route_id)
        REFERENCES routes(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_route_pickup_points_route
    ON route_pickup_points(route_id, active);


-- ============================================================
-- OPERATOR ROUTES
--
-- Which operators are authorized to operate which routes.
-- ============================================================

CREATE TABLE IF NOT EXISTS operator_routes (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL,
    route_id TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
        CHECK (active IN (0, 1)),
    authorized_at INTEGER NOT NULL,
    revoked_at INTEGER,

    FOREIGN KEY (operator_id)
        REFERENCES operators(id)
        ON DELETE CASCADE,

    FOREIGN KEY (route_id)
        REFERENCES routes(id)
        ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_routes_unique
    ON operator_routes(operator_id, route_id);

CREATE INDEX IF NOT EXISTS idx_operator_routes_route
    ON operator_routes(route_id, active);

CREATE INDEX IF NOT EXISTS idx_operator_routes_operator
    ON operator_routes(operator_id, active);


-- ============================================================
-- TAXI ROUTE AUTHORIZATION
--
-- A taxi may be authorized for MANY routes.
-- This is NOT the taxi's current route.
-- ============================================================

CREATE TABLE IF NOT EXISTS taxi_routes (
    id TEXT PRIMARY KEY,
    taxi_id TEXT NOT NULL,
    route_id TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
        CHECK (active IN (0, 1)),
    authorized_at INTEGER NOT NULL,
    revoked_at INTEGER,

    FOREIGN KEY (taxi_id)
        REFERENCES taxis(id)
        ON DELETE CASCADE,

    FOREIGN KEY (route_id)
        REFERENCES routes(id)
        ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_taxi_routes_unique
    ON taxi_routes(taxi_id, route_id);

CREATE INDEX IF NOT EXISTS idx_taxi_routes_taxi
    ON taxi_routes(taxi_id, active);

CREATE INDEX IF NOT EXISTS idx_taxi_routes_route
    ON taxi_routes(route_id, active);


-- ============================================================
-- TAXI DRIVER ASSIGNMENTS
--
-- A driver can be assigned to a taxi.
-- The assignment is separate from route authorization.
-- ============================================================

CREATE TABLE IF NOT EXISTS taxi_driver_assignments (
    id TEXT PRIMARY KEY,
    taxi_id TEXT NOT NULL,
    driver_id TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
        CHECK (active IN (0, 1)),
    assigned_at INTEGER NOT NULL,
    ended_at INTEGER,

    FOREIGN KEY (taxi_id)
        REFERENCES taxis(id)
        ON DELETE CASCADE,

    FOREIGN KEY (driver_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_taxi_driver_assignment_taxi
    ON taxi_driver_assignments(taxi_id, active);

CREATE INDEX IF NOT EXISTS idx_taxi_driver_assignment_driver
    ON taxi_driver_assignments(driver_id, active);


-- ============================================================
-- DAILY LINE SESSIONS
--
-- One route/operator/date represents one operational loading line.
-- ============================================================

CREATE TABLE IF NOT EXISTS line_sessions (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL,
    route_id TEXT NOT NULL,
    service_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN'
        CHECK (
            status IN (
                'OPEN',
                'ACTIVE',
                'CLOSED',
                'CANCELLED'
            )
        ),
    opened_by TEXT,
    opened_at INTEGER NOT NULL,
    closed_at INTEGER,

    FOREIGN KEY (operator_id)
        REFERENCES operators(id)
        ON DELETE CASCADE,

    FOREIGN KEY (route_id)
        REFERENCES routes(id)
        ON DELETE CASCADE,

    FOREIGN KEY (opened_by)
        REFERENCES users(id)
        ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_line_sessions_unique
    ON line_sessions(operator_id, route_id, service_date);

CREATE INDEX IF NOT EXISTS idx_line_sessions_date
    ON line_sessions(service_date, status);


-- ============================================================
-- DAILY LINE ENTRIES
--
-- This is where Taxi A can be position 1 on Sun Village
-- and later participate in a Rustenburg line.
-- ============================================================

CREATE TABLE IF NOT EXISTS line_entries (
    id TEXT PRIMARY KEY,
    line_session_id TEXT NOT NULL,
    taxi_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'WAITING'
        CHECK (
            status IN (
                'WAITING',
                'LOADING',
                'DISPATCHED',
                'REMOVED',
                'REPLACED',
                'COMPLETED'
            )
        ),
    joined_at INTEGER NOT NULL,
    loading_started_at INTEGER,
    removed_at INTEGER,

    FOREIGN KEY (line_session_id)
        REFERENCES line_sessions(id)
        ON DELETE CASCADE,

    FOREIGN KEY (taxi_id)
        REFERENCES taxis(id)
        ON DELETE CASCADE,

    CHECK (position >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_line_entries_position
    ON line_entries(line_session_id, position);

CREATE INDEX IF NOT EXISTS idx_line_entries_session
    ON line_entries(line_session_id, status);

CREATE INDEX IF NOT EXISTS idx_line_entries_taxi
    ON line_entries(taxi_id, status);


-- ============================================================
-- TRIPS / DEPARTURES
--
-- Physical taxi != current trip.
--
-- The same taxi can complete:
--   Trip A: Mabeskraal -> Sun Village
-- then later:
--   Trip B: Mabeskraal -> Rustenburg
-- ============================================================

CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY,
    taxi_id TEXT NOT NULL,
    line_entry_id TEXT,
    route_id TEXT NOT NULL,
    driver_id TEXT,
    status TEXT NOT NULL DEFAULT 'LOADING'
        CHECK (
            status IN (
                'LOADING',
                'COLLECTING',
                'FULL',
                'DEPARTED',
                'ARRIVED',
                'CANCELLED',
                'OFFLINE'
            )
        ),
    capacity INTEGER NOT NULL,
    passengers_onboard INTEGER NOT NULL DEFAULT 0,
    seats_remaining INTEGER NOT NULL DEFAULT 0,
    started_at INTEGER NOT NULL,
    last_updated INTEGER NOT NULL,
    departed_at INTEGER,
    completed_at INTEGER,

    FOREIGN KEY (taxi_id)
        REFERENCES taxis(id)
        ON DELETE CASCADE,

    FOREIGN KEY (line_entry_id)
        REFERENCES line_entries(id)
        ON DELETE SET NULL,

    FOREIGN KEY (route_id)
        REFERENCES routes(id)
        ON DELETE RESTRICT,

    FOREIGN KEY (driver_id)
        REFERENCES users(id)
        ON DELETE SET NULL,

    CHECK (capacity > 0),
    CHECK (passengers_onboard >= 0),
    CHECK (passengers_onboard <= capacity),
    CHECK (seats_remaining >= 0),
    CHECK (seats_remaining <= capacity)
);

CREATE INDEX IF NOT EXISTS idx_trips_route_status
    ON trips(route_id, status);

CREATE INDEX IF NOT EXISTS idx_trips_taxi
    ON trips(taxi_id, status);

CREATE INDEX IF NOT EXISTS idx_trips_driver
    ON trips(driver_id, status);

CREATE INDEX IF NOT EXISTS idx_trips_updated
    ON trips(last_updated);


-- ============================================================
-- ROUTE-CENTRIC WAITING PASSENGERS
--
-- Passengers are NOT associated with an operator.
--
-- pickup_point_id is NULL for rank-departure demand.
-- For COLLECTION/HYBRID it identifies the approved pickup point.
-- ============================================================

CREATE TABLE IF NOT EXISTS route_waiting_passengers (
    id TEXT PRIMARY KEY,
    passenger_id TEXT NOT NULL,
    route_id TEXT NOT NULL,
    pickup_point_id TEXT,
    group_size INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'WAITING'
        CHECK (
            status IN (
                'WAITING',
                'ASSIGNED',
                'COLLECTED',
                'CANCELLED',
                'EXPIRED'
            )
        ),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    assigned_trip_id TEXT,

    FOREIGN KEY (passenger_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    FOREIGN KEY (route_id)
        REFERENCES routes(id)
        ON DELETE CASCADE,

    FOREIGN KEY (pickup_point_id)
        REFERENCES route_pickup_points(id)
        ON DELETE SET NULL,

    FOREIGN KEY (assigned_trip_id)
        REFERENCES trips(id)
        ON DELETE SET NULL,

    CHECK (group_size >= 1)
);

CREATE INDEX IF NOT EXISTS idx_route_waiting_route
    ON route_waiting_passengers(route_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_route_waiting_pickup
    ON route_waiting_passengers(pickup_point_id, status);

CREATE INDEX IF NOT EXISTS idx_route_waiting_passenger
    ON route_waiting_passengers(passenger_id, status);

CREATE INDEX IF NOT EXISTS idx_route_waiting_trip
    ON route_waiting_passengers(assigned_trip_id, status);


-- ============================================================
-- DEMAND SIGNALS
--
-- Separate from an individual waiting request.
--
-- This allows the platform to measure route demand and show
-- demand to operators/drivers without pretending every demand
-- signal is a passenger physically waiting for pickup.
-- ============================================================

CREATE TABLE IF NOT EXISTS demand_signals (
    id TEXT PRIMARY KEY,
    route_id TEXT NOT NULL,
    pickup_point_id TEXT,
    passenger_id TEXT,
    group_size INTEGER NOT NULL DEFAULT 1,
    signal_type TEXT NOT NULL
        CHECK (
            signal_type IN (
                'WAITING',
                'INTEREST',
                'DEMAND'
            )
        ),
    status TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (
            status IN (
                'ACTIVE',
                'FULFILLED',
                'CANCELLED',
                'EXPIRED'
            )
        ),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    FOREIGN KEY (route_id)
        REFERENCES routes(id)
        ON DELETE CASCADE,

    FOREIGN KEY (pickup_point_id)
        REFERENCES route_pickup_points(id)
        ON DELETE SET NULL,

    FOREIGN KEY (passenger_id)
        REFERENCES users(id)
        ON DELETE SET NULL,

    CHECK (group_size >= 1)
);

CREATE INDEX IF NOT EXISTS idx_demand_route_status
    ON demand_signals(route_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_demand_pickup
    ON demand_signals(pickup_point_id, status);


-- ============================================================
-- SUMMON REQUESTS
--
-- taxi_id NULL:
--   generic route demand / summon.
--
-- taxi_id populated:
--   summon a specific taxi.
-- ============================================================

CREATE TABLE IF NOT EXISTS route_summon_requests (
    id TEXT PRIMARY KEY,
    route_id TEXT NOT NULL,
    taxi_id TEXT,
    conductor_id TEXT NOT NULL,
    passenger_count INTEGER NOT NULL DEFAULT 1,
    request_type TEXT NOT NULL
        CHECK (
            request_type IN (
                'ROUTE_DEMAND',
                'SPECIFIC_TAXI'
            )
        ),
    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (
            status IN (
                'PENDING',
                'ACKNOWLEDGED',
                'ACCEPTED',
                'DECLINED',
                'CANCELLED',
                'COMPLETED'
            )
        ),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    FOREIGN KEY (route_id)
        REFERENCES routes(id)
        ON DELETE CASCADE,

    FOREIGN KEY (taxi_id)
        REFERENCES taxis(id)
        ON DELETE SET NULL,

    FOREIGN KEY (conductor_id)
        REFERENCES users(id)
        ON DELETE RESTRICT,

    CHECK (passenger_count >= 1)
);

CREATE INDEX IF NOT EXISTS idx_summons_route_status
    ON route_summon_requests(route_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_summons_taxi_status
    ON route_summon_requests(taxi_id, status);


-- ============================================================
-- AUDIT LOG
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor_user_id TEXT,
    operator_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    details_json TEXT,
    timestamp INTEGER NOT NULL,

    FOREIGN KEY (actor_user_id)
        REFERENCES users(id)
        ON DELETE SET NULL,

    FOREIGN KEY (operator_id)
        REFERENCES operators(id)
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp
    ON audit_logs(timestamp);

CREATE INDEX IF NOT EXISTS idx_audit_operator
    ON audit_logs(operator_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_audit_entity
    ON audit_logs(entity_type, entity_id);


-- ============================================================
-- TAXI METADATA
--
-- Add vehicle registration separately from legal operator
-- registration number.
--
-- SQLite does not support ADD COLUMN IF NOT EXISTS, so this
-- migration deliberately does NOT alter the existing taxis
-- table yet. The Worker migration phase will replace the
-- legacy taxi representation safely.
-- ============================================================


-- ============================================================
-- HELPFUL INDEXES ON EXISTING USERS
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_users_role_active
    ON users(role, active);


-- ============================================================
-- DOCUMENTATION / VERSION MARKER
-- ============================================================

CREATE TABLE IF NOT EXISTS schema_versions (
    version TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at INTEGER NOT NULL
);
