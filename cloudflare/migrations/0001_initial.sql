PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('driver', 'conductor', 'passenger')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS taxis (
    id TEXT PRIMARY KEY,
    driver_id TEXT NOT NULL,
    driver_name TEXT NOT NULL,
    route TEXT NOT NULL CHECK (route IN ('SUN_CITY', 'RUSTENBURG')),
    capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 22),
    passengers_onboard INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (
        status IN ('loading', 'full', 'departed', 'breakdown')
    ),
    created_at INTEGER NOT NULL,
    last_updated INTEGER NOT NULL,
    FOREIGN KEY (driver_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_taxis_route
    ON taxis(route);

CREATE INDEX IF NOT EXISTS idx_taxis_status
    ON taxis(status);

CREATE INDEX IF NOT EXISTS idx_taxis_driver
    ON taxis(driver_id);

CREATE TABLE IF NOT EXISTS waiting_passengers (
    id TEXT PRIMARY KEY,
    passenger_id TEXT NOT NULL,
    route TEXT NOT NULL CHECK (route IN ('SUN_CITY', 'RUSTENBURG')),
    group_size INTEGER NOT NULL CHECK (group_size BETWEEN 1 AND 10),
    taxi_id TEXT,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (passenger_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_waiting_route
    ON waiting_passengers(route);

CREATE INDEX IF NOT EXISTS idx_waiting_passenger
    ON waiting_passengers(passenger_id);

CREATE INDEX IF NOT EXISTS idx_waiting_timestamp
    ON waiting_passengers(timestamp);

CREATE TABLE IF NOT EXISTS summon_requests (
    id TEXT PRIMARY KEY,
    route TEXT NOT NULL CHECK (route IN ('SUN_CITY', 'RUSTENBURG')),
    passenger_count INTEGER NOT NULL CHECK (passenger_count >= 1),
    conductor_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    FOREIGN KEY (conductor_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_summons_route
    ON summon_requests(route);

CREATE TABLE IF NOT EXISTS demand_heatmap (
    route TEXT PRIMARY KEY CHECK (route IN ('SUN_CITY', 'RUSTENBURG')),
    count INTEGER NOT NULL DEFAULT 0,
    last_updated INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS history (
    id TEXT PRIMARY KEY,
    taxi_id TEXT,
    driver_id TEXT,
    route TEXT,
    status TEXT,
    passengers_onboard INTEGER,
    timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS approved_phones (
    phone TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('driver', 'conductor')),
    approved_by TEXT NOT NULL,
    timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS announcements (
    id TEXT PRIMARY KEY,
    village TEXT,
    message TEXT NOT NULL,
    conductor_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    expires INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_announcements_village
    ON announcements(village);

CREATE INDEX IF NOT EXISTS idx_announcements_expires
    ON announcements(expires);

CREATE TABLE IF NOT EXISTS passenger_preferences (
    passenger_id TEXT PRIMARY KEY,
    preferences_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (passenger_id) REFERENCES users(id)
);
