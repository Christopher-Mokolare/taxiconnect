# TaxiConnect — Production Record Creation & Lifecycle Guide

## Purpose

This document explains how TaxiConnect creates and manages the main production control-plane records so that an operator can research the implementation before creating real production data.

This is a **documentation/research guide**, not a production seed script.

Current production Super Admin flow:

```
Super Admin
   |
   +--> Operator
   |      |
   |      +--> Operator membership/admin
   |      +--> Route authorization
   |      +--> Taxis
   |      +--> Operational users
   |
   +--> Route
   |
   +--> Platform audit / incidents
```

The important principle is that production records should represent real entities. Do not create fake operators or routes merely to populate the dashboard.

---

## 1. Super Admin

A Super Admin is a row in `users` with:

- `system_role = 'superadmin'`
- `active = 1`
- normal user identity fields such as `id`, `name`, and timestamps

The production Super Admin currently used by TaxiConnect is provisioned separately from normal operator users.

Authentication is:

```
POST /api/auth/login

{
  "role": "superadmin",
  "name": "Christopher Mokolare",
  "pin": "<production PIN>"
}
```

The PIN is stored as a Worker secret, not in D1.

After successful authentication, the Worker returns a session token. The Admin UI stores that token in `sessionStorage` and sends:

```
Authorization: Bearer <token>
```

for subsequent administration requests.

---

# 2. Creating an Operator

## UI

The Super Admin page is:

```
/admin.html
```

Select:

```
Operators
```

The page exposes **Create operator** with:

- Operator name
- Registration number
- Phone
- Email
- Address

The frontend sends:

```
POST /api/superadmin/operator/create
```

with:

```json
{
  "name": "...",
  "registrationNumber": "...",
  "phone": "...",
  "email": "...",
  "address": "..."
}
```

## What the record represents

An operator is the platform authorization/ownership boundary for an association or operating organization.

It is **not** a passenger account.

It should therefore contain the actual legal/operational identity of the organization.

For production:

- use the real operator/association name;
- use the actual registration number where applicable;
- use real contact information;
- do not use E2E/test values.

---

# 3. Operator lifecycle: create vs deactivate

The current implementation deliberately does **not** expose a hard-delete button for operators.

The Admin UI displays:

```
ACTIVE     -> Deactivate
INACTIVE   -> Activate
```

The frontend sends:

```
POST /api/superadmin/operator/status
```

with:

```json
{
  "operatorId": "<operator id>",
  "active": false
}
```

To reactivate:

```
{
  "operatorId": "<operator id>",
  "active": true
}
```

### Important

Deactivation is a **soft lifecycle change**.

It means:

```
record remains in D1
        |
        +--> active = 0
        |
        +--> excluded from active operational queries
```

Therefore, creating an operator is not equivalent to creating an irreversible active entity.

However, the historical database row remains.

This is intentional because deleting an operator can affect:

- operator memberships;
- route authorizations;
- taxis;
- trips;
- incidents;
- audit relationships.

Cloudflare D1 enforces foreign keys, which can prevent deletion of parent rows that are still referenced by child rows. See the Cloudflare D1 foreign-key documentation:

https://developers.cloudflare.com/d1/sql-api/foreign-keys/

---

# 4. Creating a Route

The Super Admin Routes page exposes **Create route**.

Fields:

- Origin
- Destination
- Display name
- Service mode

The frontend sends:

```
POST /api/superadmin/route/create
```

Example:

```json
{
  "origin": "Mabeskraal",
  "destination": "Rustenburg",
  "name": "Mabeskraal → Rustenburg",
  "serviceMode": "RANK_DEPARTURE"
}
```

Supported service modes:

- `RANK_DEPARTURE`
- `COLLECTION`
- `HYBRID`

The current database design treats the route as a first-class entity.

There is also a uniqueness constraint/index for the route origin/destination pair.

---

# 5. Route lifecycle

Routes use the same soft lifecycle pattern as operators.

The UI provides:

```
ACTIVE     -> Deactivate
INACTIVE   -> Activate
```

The request is:

```
POST /api/superadmin/route/status
```

Example:

```json
{
  "routeId": "<route id>",
  "active": false
}
```

A deactivated route remains available for historical relationships but should no longer be returned by active operational queries.

---

# 6. Authorizing an Operator for a Route

Creating a route does **not** automatically mean every operator can use it.

The Super Admin UI has:

```
Authorize operator on route
```

It sends:

```
POST /api/superadmin/operator/authorize-route
```

with:

```json
{
  "operatorId": "<operator id>",
  "routeId": "<route id>"
}
```

This creates/activates the relationship between the operator and route.

Conceptually:

```
operators
    |
    +---- operator_routes ----+
                              |
                            routes
```

This allows the same route to be used by multiple operators without storing a permanent single operator on the route itself.

---

# 7. Creating an Operator Admin

The Super Admin UI also exposes:

```
Create operator admin
```

Fields:

- Operator
- Admin full name
- Phone

The request is:

```
POST /api/superadmin/operator-admin/create
```

with:

```
{
  "operatorId": "<operator id>",
  "name": "...",
  "phone": "..."
}
```

The important design point is that the user account and operator authorization are separate concepts.

The user receives an operator-level role/membership rather than making the user a global Super Admin.

---

# 8. Operator memberships

TaxiConnect uses `operator_memberships` to associate operational users with operators.

This supports:

- one operator having multiple users;
- users having operator-level authorization;
- different membership roles;
- operators being an authorization boundary.

This is preferable to permanently putting a single `operator_id` on every user.

The code uses membership checks such as:

```
requireOperatorMembership(...)
requireSpecificOperatorMembership(...)
```

before protected operational operations.

---

# 9. Taxis

A taxi is a physical vehicle.

Important fields include:

- taxi ID;
- operator ID;
- vehicle registration number;
- capacity;
- driver assignment;
- active status;
- operational status.

Taxi registration and operator identity are deliberately different:

```
operator.registration_number
        !=
taxi.vehicle_registration_number
```

A taxi can also be authorized for multiple routes through `taxi_routes`.

Therefore:

```
Taxi
  |
  +--> Operator
  |
  +--> Route A
  |
  +--> Route B
```

The taxi does not have one permanent route.

---

# 10. Users

The user model contains normal roles such as:

- passenger
- driver
- conductor

and system roles such as:

- operator_admin
- superadmin

The Admin UI currently displays users but does not provide a hard-delete button.

This is deliberate because users can be referenced by:

- trips;
- audit records;
- operator memberships;
- incidents;
- driver assignments;
- other historical records.

The preferred lifecycle is therefore to deactivate a user rather than erase historical identity.

---

# 11. Trips

Trips represent operational history.

The platform supports statuses such as:

- LOADING
- COLLECTING
- FULL
- DEPARTED
- ARRIVED
- CANCELLED
- OFFLINE

Trips should **not be treated as disposable configuration records**.

A completed trip is historical evidence of an actual operation.

Therefore the Super Admin UI does not provide a delete-trip operation.

For example:

```
LOADING
   ↓
FULL
   ↓
DEPARTED
   ↓
ARRIVED
```

A trip can have:

- passenger counts;
- departure time;
- completion time;
- taxi;
- route;
- driver;
- operator;
- audit entries.

Deleting it would destroy operational history.

---

# 12. Audit records

The platform has an `audit_logs` table.

Audit records capture information such as:

- actor;
- operator;
- action;
- entity type;
- entity ID;
- details;
- timestamp.

The Super Admin UI displays the audit log but does not expose deletion.

This should remain append-oriented.

For example:

```
Super Admin
    |
    +--> creates operator
            |
            +--> audit record
```

and:

```
Super Admin
    |
    +--> deactivates operator
            |
            +--> audit record
```

This gives you a historical explanation of what happened rather than silently removing evidence.

---

# 13. Incidents

System incidents are also lifecycle records.

Statuses include:

- OPEN
- ACKNOWLEDGED
- RESOLVED
- CLOSED

The Admin UI provides:

```
Resolve
```

rather than delete.

The API is:

```
POST /api/superadmin/incident/status
```

Example:

```
{
  "incidentId": "<incident id>",
  "status": "RESOLVED"
}
```

The incident remains in the database after resolution.

---

# 14. Why the platform uses soft deactivation

The distinction is:

### Configuration/entity

```
Operator
Route
User
Taxi
```

These can have an active/inactive lifecycle.

### Historical/operational records

```
Trip
Audit
Incident
```

These should generally remain permanently available for historical investigation.

This avoids the situation where:

```
Trip 123
   |
   +--> operator XYZ
```

and later deleting XYZ makes the historical record meaningless.

Cloudflare D1's foreign-key enforcement is specifically designed to maintain valid relationships between related records. citeturn0search0

---

# 15. Researching the implementation yourself

## Repository locations

### Super Admin frontend

```
public/admin.html
```

This is the easiest place to understand what actions the UI exposes.

Look for:

```
createOperator()
createRoute()
createOperatorAdmin()
authorizeOperatorRoute()
operatorStatus()
routeStatus()
incidentStatus()
```

### Worker API

```
cloudflare/src/index.js
```

Search for:

```
superadmin
operator/create
operator/status
route/create
route/status
operator-admin/create
authorize-route
incident/status
```

### Database migrations

```
cloudflare/migrations/
```

The schema evolved through migrations rather than being defined only in the Worker.

Important migrations include:

```
0001_initial.sql
0002_complete_backend.sql
0003_route_first_domain.sql
0004_finalize_vehicle_model.sql
0005_passenger_location.sql
0006_system_roles.sql
0007_bidirectional_route_journeys.sql
0008_journey_aware_uniqueness.sql
0009_demand_journey_uniqueness.sql
0010_finalize_taxi_vehicle_model.sql
0011_platform_control_plane.sql
0012_incident_model.sql
```

---

# 16. Useful D1 research commands

Never accidentally point these at production when experimenting.

For local development:

```bash
cd cloudflare
npx wrangler d1 execute taxiconnect --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

Inspect a table:

```bash
npx wrangler d1 execute taxiconnect --local --command 'PRAGMA table_info("operators");'
```

Inspect foreign keys:

```bash
npx wrangler d1 execute taxiconnect --local --command 'PRAGMA foreign_key_list("operators");'
```

Check foreign-key integrity:

```bash
npx wrangler d1 execute taxiconnect --local --command 'PRAGMA foreign_key_check;'
```

Find active operators:

```bash
npx wrangler d1 execute taxiconnect --local --command "SELECT id,name,registration_number,active FROM operators ORDER BY name;"
```

Find inactive operators:

```bash
npx wrangler d1 execute taxiconnect --local --command "SELECT id,name,registration_number,active FROM operators WHERE active=0 ORDER BY name;"
```

Cloudflare documents `PRAGMA table_info`, `PRAGMA foreign_key_list`, and `PRAGMA foreign_key_check` for D1 schema investigation. citeturn0search2

---

# 17. Production safety rule

Before creating any production record:

1. Confirm what the record represents.
2. Confirm whether it can be deactivated.
3. Confirm whether it can be hard-deleted.
4. Check its foreign-key relationships.
5. Use real production information.
6. Avoid E2E/test names and IDs.
7. Prefer local D1 for experimentation.
8. Use migrations for schema changes.

Do not use production as a development sandbox.

Cloudflare specifically recommends testing against a separate staging database before production migrations. citeturn0search11

---

# 18. Current TaxiConnect production control-plane model

The intended production structure is:

```
SUPER ADMIN
    |
    +------------------+
    |                  |
    v                  v
OPERATORS           ROUTES
    |                  |
    |                  |
    +------ ROUTE AUTHORIZATION
    |
    +--> OPERATOR MEMBERS
    |
    +--> TAXIS
            |
            +--> TAXI ROUTE AUTHORIZATION
            |
            +--> DRIVER ASSIGNMENT
            |
            +--> DAILY LOADING LINE
                    |
                    +--> TRIP
                            |
                            +--> PASSENGERS
```

The Super Admin controls platform-level configuration and authorization.

The Operator controls its operational resources.

The Driver/Conductor operate the daily taxi workflow.

The Passenger does not belong to an operator.

---

## Recommended research order

If you want to understand the implementation yourself, read in this order:

1. `public/admin.html`
2. Super Admin route handlers in `cloudflare/src/index.js`
3. `0001_initial.sql`
4. `0003_route_first_domain.sql`
5. `0006_system_roles.sql`
6. `0010_finalize_taxi_vehicle_model.sql`
7. `0011_platform_control_plane.sql`
8. `0012_incident_model.sql`
9. E2E seed data under `cloudflare/tests/`

That gives you the path from **UI → API → authorization → SQL schema → relationships → lifecycle**.

## External references

- Cloudflare D1 SQL API: https://developers.cloudflare.com/d1/sql-api/
- Cloudflare D1 foreign keys: https://developers.cloudflare.com/d1/sql-api/foreign-keys/
- Cloudflare D1 SQL statements / schema inspection: https://developers.cloudflare.com/d1/sql-api/sql-statements/
- Cloudflare D1 migrations: https://developers.cloudflare.com/d1/reference/migrations/
- Cloudflare D1 import/export: https://developers.cloudflare.com/d1/best-practices/import-export-data/

These are useful when researching why TaxiConnect uses relational constraints and lifecycle/deactivation rather than indiscriminate hard deletion.
