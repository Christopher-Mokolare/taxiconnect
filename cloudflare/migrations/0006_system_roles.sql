-- Add system-level authorization roles without changing the
-- legacy operational users.role constraint.
--
-- users.role:
--   passenger
--   driver
--   conductor
--
-- users.system_role:
--   operator_admin
--   superadmin

ALTER TABLE users
ADD COLUMN system_role TEXT
CHECK (
    system_role IS NULL
    OR system_role IN ('operator_admin', 'superadmin')
);
