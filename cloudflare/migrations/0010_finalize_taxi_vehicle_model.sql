CREATE TABLE taxis_new (
    id TEXT PRIMARY KEY,
    driver_id TEXT,
    driver_name TEXT,
    capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 22),
    passengers_onboard INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (
        status IN (
            'OFFLINE',
            'loading',
            'full',
            'departed',
            'breakdown'
        )
    ),
    created_at INTEGER NOT NULL,
    last_updated INTEGER NOT NULL,
    operator_id TEXT,
    vehicle_registration_number TEXT,
    active INTEGER NOT NULL DEFAULT 1
        CHECK (active IN (0, 1)),
    FOREIGN KEY (driver_id) REFERENCES users(id)
);

INSERT INTO taxis_new (
    id,
    driver_id,
    driver_name,
    capacity,
    passengers_onboard,
    status,
    created_at,
    last_updated,
    operator_id,
    vehicle_registration_number,
    active
)
SELECT
    id,
    NULLIF(driver_id, ''),
    NULLIF(driver_name, ''),
    capacity,
    passengers_onboard,
    CASE
        WHEN status IN ('loading', 'full', 'departed', 'breakdown')
            THEN status
        ELSE 'OFFLINE'
    END,
    created_at,
    last_updated,
    operator_id,
    vehicle_registration_number,
    active
FROM taxis;

DROP TABLE taxis;

ALTER TABLE taxis_new RENAME TO taxis;

CREATE INDEX IF NOT EXISTS idx_taxis_status
    ON taxis(status);

CREATE INDEX IF NOT EXISTS idx_taxis_driver
    ON taxis(driver_id);

CREATE INDEX IF NOT EXISTS idx_taxis_operator
    ON taxis(operator_id, active);

CREATE UNIQUE INDEX IF NOT EXISTS idx_taxis_vehicle_registration
    ON taxis(vehicle_registration_number)
    WHERE vehicle_registration_number IS NOT NULL;
