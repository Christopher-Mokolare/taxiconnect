-- Establish the vehicle metadata columns before the final taxi-table rebuild.
-- This migration fixes fresh installations where the legacy 0001 taxis table
-- does not yet contain operator_id, vehicle_registration_number or active.

ALTER TABLE taxis
ADD COLUMN operator_id TEXT;

ALTER TABLE taxis
ADD COLUMN vehicle_registration_number TEXT;

ALTER TABLE taxis
ADD COLUMN active INTEGER NOT NULL DEFAULT 1
CHECK (active IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_taxis_operator_legacy
ON taxis(operator_id, active);
