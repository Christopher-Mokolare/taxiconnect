-- TaxiConnect compliance and operational readiness
-- Minimum credential metadata only; underlying sensitive documents remain outside TaxiConnect.

ALTER TABLE users ADD COLUMN driver_license_number TEXT;
ALTER TABLE users ADD COLUMN prdp_number TEXT;
ALTER TABLE users ADD COLUMN prdp_category TEXT;
ALTER TABLE users ADD COLUMN prdp_expiry_date TEXT;
ALTER TABLE users ADD COLUMN compliance_status TEXT NOT NULL DEFAULT 'NOT_PROVIDED' CHECK (compliance_status IN ('NOT_PROVIDED','PENDING','VALID','EXPIRED','SUSPENDED','NOT_APPLICABLE'));
ALTER TABLE users ADD COLUMN compliance_verified_at INTEGER;

ALTER TABLE operators ADD COLUMN operating_license_number TEXT;
ALTER TABLE operators ADD COLUMN operating_license_expiry_date TEXT;
ALTER TABLE operators ADD COLUMN tax_clearance_status TEXT NOT NULL DEFAULT 'NOT_PROVIDED' CHECK (tax_clearance_status IN ('NOT_PROVIDED','PENDING','VALID','EXPIRED','SUSPENDED','NOT_APPLICABLE'));
ALTER TABLE operators ADD COLUMN tax_clearance_expiry_date TEXT;
ALTER TABLE operators ADD COLUMN association_reference TEXT;
ALTER TABLE operators ADD COLUMN compliance_verified_at INTEGER;

ALTER TABLE taxis ADD COLUMN roadworthy_certificate_number TEXT;
ALTER TABLE taxis ADD COLUMN roadworthy_expiry_date TEXT;
ALTER TABLE taxis ADD COLUMN roadworthy_status TEXT NOT NULL DEFAULT 'NOT_PROVIDED' CHECK (roadworthy_status IN ('NOT_PROVIDED','PENDING','VALID','EXPIRED','SUSPENDED','NOT_APPLICABLE'));
ALTER TABLE taxis ADD COLUMN compliance_verified_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_users_prdp_expiry ON users(role,prdp_expiry_date,compliance_status);
CREATE INDEX IF NOT EXISTS idx_operators_license_expiry ON operators(operating_license_expiry_date,tax_clearance_status);
CREATE INDEX IF NOT EXISTS idx_taxis_roadworthy_expiry ON taxis(roadworthy_expiry_date,roadworthy_status);
