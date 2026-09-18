PRAGMA foreign_keys = ON;

-- Platform-wide operational incidents and failures.
CREATE TABLE IF NOT EXISTS system_incidents (
    id TEXT PRIMARY KEY,
    severity TEXT NOT NULL CHECK (severity IN ('INFO','WARNING','ERROR','CRITICAL')),
    status TEXT NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED','CLOSED')),
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    correlation_id TEXT,
    operator_id TEXT,
    route_id TEXT,
    actor_user_id TEXT,
    details_json TEXT,
    created_at INTEGER NOT NULL,
    acknowledged_at INTEGER,
    acknowledged_by TEXT,
    resolved_at INTEGER,
    resolved_by TEXT,
    FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE SET NULL,
    FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE SET NULL,
    FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (acknowledged_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_system_incidents_status
    ON system_incidents(status, created_at);

CREATE INDEX IF NOT EXISTS idx_system_incidents_operator
    ON system_incidents(operator_id, created_at);

CREATE INDEX IF NOT EXISTS idx_system_incidents_route
    ON system_incidents(route_id, created_at);

CREATE INDEX IF NOT EXISTS idx_system_incidents_correlation
    ON system_incidents(correlation_id);

-- Platform configuration is deliberately small and auditable.
CREATE TABLE IF NOT EXISTS platform_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    updated_by TEXT,
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Helpful indexes for platform administration.
CREATE INDEX IF NOT EXISTS idx_users_system_role_active
    ON users(system_role, active);

CREATE INDEX IF NOT EXISTS idx_trips_started
    ON trips(started_at);

CREATE INDEX IF NOT EXISTS idx_taxis_active_operator
    ON taxis(operator_id, active);
