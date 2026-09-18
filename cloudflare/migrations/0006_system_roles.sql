-- Add system-level authorization roles and the user contact/session fields
-- required by the current Worker control plane.

ALTER TABLE users
ADD COLUMN phone TEXT;

ALTER TABLE users
ADD COLUMN last_seen_at INTEGER;

ALTER TABLE users
ADD COLUMN system_role TEXT
CHECK (
    system_role IS NULL
    OR system_role IN ('operator_admin', 'superadmin')
);
