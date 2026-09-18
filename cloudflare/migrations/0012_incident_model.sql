PRAGMA foreign_keys = ON;

-- Evolve the platform incident model without dropping existing incident data.
-- Existing WARNING/CLOSED values are normalized to the newer WARN/RESOLVED vocabulary.
CREATE TABLE system_incidents_v2 (
    id TEXT PRIMARY KEY,
    severity TEXT NOT NULL CHECK (severity IN ('INFO','WARN','ERROR','CRITICAL')),
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    stack TEXT,
    request_path TEXT,
    request_method TEXT,
    actor_user_id TEXT,
    operator_id TEXT,
    route_id TEXT,
    correlation_id TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
    created_at INTEGER NOT NULL,
    acknowledged_at INTEGER,
    acknowledged_by TEXT,
    resolved_at INTEGER,
    resolved_by TEXT,
    FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE SET NULL,
    FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE SET NULL,
    FOREIGN KEY (acknowledged_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO system_incidents_v2 (
    id, severity, source, message, stack, request_path, request_method,
    actor_user_id, operator_id, route_id, correlation_id, metadata_json,
    status, created_at, acknowledged_at, acknowledged_by, resolved_at, resolved_by
)
SELECT
    id,
    CASE severity WHEN 'WARNING' THEN 'WARN' ELSE severity END,
    source,
    message,
    NULL,
    NULL,
    NULL,
    actor_user_id,
    operator_id,
    route_id,
    correlation_id,
    COALESCE(details_json, '{}'),
    CASE status WHEN 'CLOSED' THEN 'RESOLVED' ELSE status END,
    created_at,
    acknowledged_at,
    acknowledged_by,
    resolved_at,
    resolved_by
FROM system_incidents;

DROP TABLE system_incidents;
ALTER TABLE system_incidents_v2 RENAME TO system_incidents;

CREATE INDEX IF NOT EXISTS idx_system_incidents_status
  ON system_incidents(status, created_at);
CREATE INDEX IF NOT EXISTS idx_system_incidents_severity
  ON system_incidents(severity, created_at);
CREATE INDEX IF NOT EXISTS idx_system_incidents_operator
  ON system_incidents(operator_id, created_at);
CREATE INDEX IF NOT EXISTS idx_system_incidents_route
  ON system_incidents(route_id, created_at);
CREATE INDEX IF NOT EXISTS idx_system_incidents_correlation
  ON system_incidents(correlation_id);
