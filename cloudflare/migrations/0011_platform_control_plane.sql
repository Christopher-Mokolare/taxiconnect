PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS system_incidents (
    id TEXT PRIMARY KEY,
    severity TEXT NOT NULL CHECK (severity IN ('INFO','WARN','ERROR','CRITICAL')),
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    stack TEXT,
    request_path TEXT,
    request_method TEXT,
    actor_user_id TEXT,
    operator_id TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
    created_at INTEGER NOT NULL,
    acknowledged_at INTEGER,
    resolved_at INTEGER,
    resolved_by TEXT,
    FOREIGN KEY (actor_user_id) REFERENCES users(id),
    FOREIGN KEY (operator_id) REFERENCES operators(id),
    FOREIGN KEY (resolved_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_system_incidents_status
  ON system_incidents(status, created_at);

CREATE INDEX IF NOT EXISTS idx_system_incidents_severity
  ON system_incidents(severity, created_at);

CREATE INDEX IF NOT EXISTS idx_system_incidents_operator
  ON system_incidents(operator_id, created_at);
