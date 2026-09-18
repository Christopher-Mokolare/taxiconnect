PRAGMA foreign_keys = ON;

-- last_seen_at already exists in users

CREATE INDEX IF NOT EXISTS idx_users_role_active
ON users(role, active);

CREATE INDEX IF NOT EXISTS idx_waiting_route
ON waiting_passengers(route);

CREATE INDEX IF NOT EXISTS idx_waiting_taxi
ON waiting_passengers(taxi_id);

CREATE INDEX IF NOT EXISTS idx_summon_route
ON summon_requests(route);

CREATE INDEX IF NOT EXISTS idx_history_timestamp
ON history(timestamp);
