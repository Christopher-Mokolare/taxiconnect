PRAGMA foreign_keys=ON;

DELETE FROM system_incidents;
DELETE FROM audit_logs;
DELETE FROM taxi_driver_assignments;
DELETE FROM taxi_routes;
DELETE FROM line_entries;
DELETE FROM line_sessions;
DELETE FROM trips;
DELETE FROM route_waiting_passengers;
DELETE FROM demand_signals;
DELETE FROM operator_memberships;
DELETE FROM operators;
DELETE FROM route_pickup_points;
DELETE FROM routes;
DELETE FROM taxis;
DELETE FROM users;

INSERT INTO users (id,name,role,system_role,active,created_at,last_seen_at)
VALUES
('e2e-superadmin','E2E Super Admin','passenger','superadmin',1,1,1),
('e2e-operator-admin','E2E Operator Admin','passenger','operator_admin',1,1,1),
('e2e-driver','E2E Driver','driver',NULL,1,1,1),
('e2e-conductor','E2E Conductor','conductor',NULL,1,1,1),
('e2e-passenger','E2E Passenger','passenger',NULL,1,1,1);

INSERT INTO operators (id,name,registration_number,phone,email,address,active,created_at,updated_at)
VALUES ('e2e-operator','E2E Transport Association','E2E-OP-001','0100000000','ops@example.test','Test Address',1,1,1);

INSERT INTO routes (id,origin,destination,name,service_mode,active,created_at,updated_at)
VALUES ('e2e-route','Mabeskraal','Rustenburg','Mabeskraal → Rustenburg','RANK_DEPARTURE',1,1,1);

INSERT INTO route_pickup_points
(id,route_id,name,point_type,sequence,active,created_at,updated_at)
VALUES
('e2e-origin','e2e-route','Mabeskraal Rank','RANK',0,1,1,1),
('e2e-mid','e2e-route','Village A','PICKUP',1,1,1,1),
('e2e-destination','e2e-route','Rustenburg Rank','RANK',2,1,1,1);

INSERT INTO operator_memberships
(id,operator_id,user_id,membership_role,active,created_at,updated_at)
VALUES
('e2e-membership-admin','e2e-operator','e2e-operator-admin','operator_admin',1,1,1),
('e2e-membership-driver','e2e-operator','e2e-driver','driver',1,1,1),
('e2e-membership-conductor','e2e-operator','e2e-conductor','conductor',1,1,1);

INSERT INTO operator_routes
(id,operator_id,route_id,active,authorized_at)
VALUES ('e2e-op-route','e2e-operator','e2e-route',1,1);

INSERT INTO taxis
(id,driver_id,driver_name,capacity,passengers_onboard,status,created_at,last_updated,operator_id,vehicle_registration_number,active)
VALUES ('e2e-taxi','e2e-driver','E2E Driver',15,0,'OFFLINE',1,1,'e2e-operator','E2E-TAXI-001',1);

INSERT INTO taxi_driver_assignments
(id,taxi_id,driver_id,active,assigned_at)
VALUES ('e2e-assignment','e2e-taxi','e2e-driver',1,1);

INSERT INTO taxi_routes
(id,taxi_id,route_id,active,authorized_at)
VALUES ('e2e-taxi-route','e2e-taxi','e2e-route',1,1);
