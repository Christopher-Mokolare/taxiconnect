# TaxiConnect — Application Intent & Product Specification

> Status: Living product and technical document  
> Runtime: Cloudflare Workers + D1 + WebSockets  
> Frontend: Static HTML/CSS/JavaScript in public/  
> Initial corridor: Sun City / Sun Village ↔ Rustenburg

---

## 1. Purpose

This document defines why TaxiConnect exists, the problem it solves, who uses it, how the transport workflow operates, the core domain model, the security model, the lifecycle model, and the engineering rules that should be preserved when the application changes.

The central product statement is:

> **TaxiConnect is a digital transport-operations and dispatch platform for route-based minibus-taxi services. It coordinates passenger demand, taxi queues, drivers, conductors, operators, routes, trips, realtime events, lifecycle state, and operational history.**

The application should be understood as an operational system, not simply a collection of CRUD screens.

The core chain is:

~~~text
PASSENGER DEMAND
       ↓
ROUTE + PICKUP POINT
       ↓
CONDUCTOR / TAXI LINE
       ↓
TAXI DISPATCH
       ↓
DRIVER + TAXI
       ↓
LOADING / COLLECTING
       ↓
FULL / DEPARTED
       ↓
ARRIVED
       ↓
HISTORY + AUDIT
~~~

---

# 2. The problem TaxiConnect is intended to solve

A route-based taxi operation involves several participants:

- passengers needing transport;
- conductors or queue/dispatch personnel;
- drivers operating taxis;
- operators managing vehicles and staff;
- platform administrators.

Important information can otherwise be fragmented:

- where passengers are waiting;
- how much demand exists;
- which taxis are available;
- which taxi should load next;
- which driver is operating which taxi;
- how many passengers are onboard;
- whether a taxi has departed;
- whether a trip has arrived;
- what happened historically.

TaxiConnect provides a shared operational model.

The intended transformation is:

~~~text
Uncoordinated activity
       ↓
Passenger demand
       ↓
Visible route demand
       ↓
Taxi queue
       ↓
Controlled dispatch
       ↓
Driver trip state
       ↓
Completed trip
       ↓
Auditable history
~~~

---

# 3. Product intent

TaxiConnect should make route-based taxi operations:

1. visible;
2. coordinated;
3. stateful;
4. role-controlled;
5. realtime;
6. auditable;
7. historically meaningful.

The product is successful when an authorized operation can be represented from passenger demand through dispatch and completed trip.

---

# 4. What TaxiConnect is not

## 4.1 Not primarily one-to-one ride hailing

The primary model is shared route transport.

~~~text
Multiple passengers
       ↓
Route demand
       ↓
Taxi loading line
       ↓
Shared taxi
       ↓
Route trip
~~~

It is not primarily:

~~~text
Passenger → nearest driver → private ride
~~~

## 4.2 Not a complete ERP

The current intent is transport operations.

It is not automatically:

- accounting;
- payroll;
- banking;
- vehicle maintenance;
- insurance;
- licensing;
- a replacement for physical taxi-rank management.

These can be future integrations or modules, but they are not the core purpose.

## 4.3 Not an unrestricted database

Core operational records should have lifecycle semantics rather than unrestricted deletion.

---

# 5. Users and responsibilities

## 5.1 Passenger

The passenger is the source of transport demand.

A passenger should be able to:

- choose a route;
- choose an origin/pickup point;
- choose a destination;
- choose a request mode;
- specify group size;
- create a waiting request;
- create a demand signal;
- cancel an active waiting request.

Example request:

~~~json
{
  "routeId": "route_123",
  "originPointId": "point_a",
  "destinationPointId": "point_b",
  "requestMode": "RANK",
  "pickupPointId": "point_a",
  "groupSize": 2
}
~~~

The important idea is that the passenger action becomes operational demand.

---

## 5.2 Conductor

The conductor is responsible for the loading line and dispatch workflow.

The conductor should answer:

~~~text
Which route am I operating?
Which taxis are available?
What passenger demand exists?
Which taxi is next?
Should a taxi be summoned?
~~~

Core operations:

~~~text
GET  /api/conductor/session
GET  /api/conductor/taxis
GET  /api/conductor/demand
GET  /api/conductor/stats
GET  /api/conductor/line

POST /api/conductor/line/open
POST /api/conductor/line/add
POST /api/conductor/line/reorder
POST /api/conductor/line/remove
POST /api/conductor/summon
~~~

---

## 5.3 Driver

The driver operates an assigned taxi.

Workflow:

~~~text
Assigned taxi
     ↓
Go live
     ↓
Loading / collecting
     ↓
Passenger count
     ↓
FULL where applicable
     ↓
DEPARTED
     ↓
ARRIVED
~~~

Core operations:

~~~text
GET  /api/driver/session
GET  /api/driver/routes
POST /api/driver/go-live
POST /api/driver/passengers
POST /api/driver/status
~~~

The driver must not be able to operate an arbitrary taxi.

The Worker enforces this through driver-to-taxi assignment checks. The implementation follows this SQL pattern:

~~~sql
SELECT
  t.id,
  t.operator_id,
  t.vehicle_registration_number,
  t.capacity,
  t.active
FROM taxi_driver_assignments a
JOIN taxis t ON t.id = a.taxi_id
JOIN operators o ON o.id = t.operator_id
WHERE a.driver_id = ?
  AND a.taxi_id = ?
  AND a.active = 1
  AND t.active = 1
  AND o.active = 1
LIMIT 1;
~~~

If no matching assignment exists, the operation is rejected with HTTP 403.

The security principle is:

> UI restrictions are not sufficient. The API must enforce ownership and authorization.

---

## 5.4 Operator Admin

An operator manages one transport operation.

The operator manages:

- taxis;
- drivers;
- conductors;
- operator memberships;
- route authorizations;
- taxi-route authorizations;
- route pickup points.

Conceptually:

~~~text
Operator
├── Operator Admin
├── Drivers
├── Conductors
├── Taxis
│   ├── Taxi A
│   ├── Taxi B
│   └── Taxi C
└── Authorized Routes
    ├── Route 1
    └── Route 2
~~~

Operator access must be scoped to the operator for which the user has active membership.

---

## 5.5 Super Admin

The Super Admin manages the platform rather than one individual operation.

Areas include:

- dashboard;
- operators;
- routes;
- users;
- taxis;
- trips;
- audit;
- incidents;
- health.

Example API:

~~~text
GET /api/superadmin/dashboard
GET /api/superadmin/operators
GET /api/superadmin/routes
GET /api/superadmin/users
GET /api/superadmin/taxis
GET /api/superadmin/trips
GET /api/superadmin/audit
GET /api/superadmin/incidents
GET /api/superadmin/health
~~~

Boundary:

~~~text
Super Admin
    ↓
Platform-wide administration

Operator Admin
    ↓
Own operator
    ├── Taxis
    ├── Drivers
    ├── Conductors
    └── Authorized routes
~~~

---

# 6. Core domain model

## 6.1 User

Represents a participant.

Important concepts:

~~~text
id
name
role
system_role
active
phone
created_at
last_login_at
last_seen_at
~~~

Roles include:

~~~text
passenger
driver
conductor
operator_admin
superadmin
~~~

## 6.2 Operator

Represents the taxi operator/business.

An operator is the ownership and authorization boundary for its operational resources.

## 6.3 Operator membership

Connects a user to an operator:

~~~text
User ← Operator Membership → Operator
                    ↓
             membership_role
~~~

This relationship is fundamental to operator-level authorization.

## 6.4 Taxi

Represents a physical taxi.

Important concepts:

~~~text
id
operator_id
vehicle_registration_number
capacity
active
driver_id
driver_name
status
last_updated
~~~

Capacity creates the invariant:

~~~text
0 <= passengersOnboard <= capacity
~~~

## 6.5 Route

Represents a transport corridor.

Example:

~~~text
Sun Village
     ↓
Rustenburg
~~~

A route has:

- origin;
- destination;
- name;
- service mode;
- pickup points;
- active state.

## 6.6 Pickup point

A pickup point belongs to a route and may contain:

- name;
- point type;
- sequence;
- latitude;
- longitude;
- address;
- active state.

Sequence gives the route an operational order.

## 6.7 Operator-route authorization

An operator must be authorized for a route.

~~~text
Operator A → Route 1: authorized
Operator A → Route 2: authorized

Operator B → Route 1: authorized
Operator B → Route 2: not authorized
~~~

## 6.8 Taxi-route authorization

A taxi must also be authorized for the route it operates.

~~~text
Taxi A
 ├── Route 1: authorized
 ├── Route 2: authorized
 └── Route 3: not authorized
~~~

This prevents a driver from selecting arbitrary routes.

## 6.9 Line session

A line session represents the operational taxi queue for a route and service date.

~~~text
Daily Line Session
 ├── Taxi 1
 ├── Taxi 2
 ├── Taxi 3
 └── Taxi 4
~~~

The line tracks ordering, loading, joining, and removal.

## 6.10 Waiting passenger

A waiting record represents a passenger's active request for transport.

It links:

~~~text
Passenger
 + Route
 + Pickup/origin
 + Destination
 + Request mode
 + Group size
~~~

## 6.11 Demand signal

A demand signal represents transport demand that can be aggregated for conductor views.

Example:

~~~text
Sun Village → Rustenburg

Pickup A: 18 passengers
Pickup B: 11 passengers
Pickup C:  4 passengers
-------------------------
Total:     33 passengers
~~~

Demand is an operational signal. It is not itself proof of a completed trip.

## 6.12 Trip

A trip represents the actual vehicle movement.

---

# 7. Trip state machine

The application explicitly restricts trip transitions.

Current transition logic includes:

~~~javascript
const TRIP_STATUS_TRANSITIONS = {
  LOADING: new Set([
    "LOADING",
    "FULL",
    "DEPARTED",
    "CANCELLED",
    "OFFLINE"
  ]),
  COLLECTING: new Set([
    "COLLECTING",
    "FULL",
    "DEPARTED",
    "CANCELLED",
    "OFFLINE"
  ]),
  FULL: new Set([
    "FULL",
    "LOADING",
    "COLLECTING",
    "DEPARTED",
    "CANCELLED",
    "OFFLINE"
  ]),
  DEPARTED: new Set([
    "DEPARTED",
    "ARRIVED"
  ]),
  ARRIVED: new Set(["ARRIVED"]),
  CANCELLED: new Set(["CANCELLED"]),
  OFFLINE: new Set(["OFFLINE"])
};
~~~

Conceptual lifecycle:

~~~text
LOADING / COLLECTING
        |
        +──→ FULL
        |
        +──→ DEPARTED
                   |
                   ↓
                ARRIVED
~~~

Invalid transitions must be rejected server-side.

For example:

~~~text
DEPARTED → LOADING
~~~

is rejected with HTTP 409 in the platform E2E test.

This protects the historical meaning of a trip.

---

# 8. Passenger demand and idempotency

Mobile/network operations are not guaranteed to arrive exactly once.

A passenger may:

- tap twice;
- retry after a timeout;
- refresh;
- reconnect;
- submit again after not receiving a response.

Therefore duplicate logical operations should not create uncontrolled duplicates.

Desired behaviour:

~~~text
Request 1
   ↓
Create waiting request
   ↓
Retry
   ↓
Return/reuse idempotent result
~~~

Not:

~~~text
Request 1 → waiting #1
Request 2 → waiting #2
Request 3 → waiting #3
~~~

The current platform E2E suite tests duplicate waiting and duplicate demand behaviour.

---

# 9. Dispatch workflow

The core dispatch chain is:

~~~text
Passenger demand
       ↓
Conductor sees demand
       ↓
Taxi line / available taxis
       ↓
Summon taxi
       ↓
Driver operates taxi
       ↓
Trip state changes
       ↓
Trip completion
~~~

The central dispatch action is:

~~~text
POST /api/conductor/summon
~~~

The product goal is not merely to record demand. It is to connect demand to an operational dispatch workflow.

---

# 10. Capacity rules

For taxi capacity C:

~~~text
0 <= passengersOnboard <= C
~~~

Example:

~~~text
capacity = 15

0
 ↓
5
 ↓
10
 ↓
15
 ↓
FULL
~~~

A count above capacity must be rejected.

This rule belongs in the API/business layer, not only the frontend.

---

# 11. Realtime intent

TaxiConnect uses Cloudflare WebSockets.

Endpoint:

~~~text
GET /ws
~~~

A connected client receives a connection event such as:

~~~json
{
  "type": "connected",
  "timestamp": 1234567890
}
~~~

Operational actions can produce broadcasts:

~~~text
Conductor action
      ↓
Cloudflare Worker
      ↓
WebSocket broadcast
      ├── Driver UI
      ├── Conductor UI
      └── Other operational clients
~~~

Realtime is a delivery mechanism.

It is not the authoritative source of truth.

---

# 12. Authentication and authorization

The Worker authenticates operational users with signed sessions.

The current role set includes:

~~~javascript
const ALLOWED_ROLES = new Set([
  "driver",
  "conductor",
  "operator_admin",
  "superadmin"
]);
~~~

The request pipeline is:

~~~text
Browser
   ↓
Bearer session
   ↓
Verify signature
   ↓
Verify expiry
   ↓
Load active user
   ↓
Check role
   ↓
Check operator membership
   ↓
Check resource ownership
   ↓
Check state transition
   ↓
D1
~~~

This layered model is more important than hiding UI controls.

---

# 13. Role isolation

The platform E2E suite verifies:

~~~text
operator_admin → superadmin endpoint = 403
conductor      → operator endpoint   = 403
driver         → conductor endpoint  = 403
unauthenticated → protected endpoint = 401
~~~

The principle is:

> **Authorization is enforced at the API boundary, not just in the frontend.**

---

# 14. Operator scoping

If Operator A and Operator B both exist, an administrator for Operator A must not automatically manage Operator B.

The server should verify:

~~~text
Authenticated user
       ↓
Active membership?
       ├── No → 403
       ↓
Resource belongs to operator?
       ├── No → deny
       ↓
Allow operation
~~~

This prevents cross-operator data access.

---

# 15. Data lifecycle

Important operational records use a lifecycle model.

~~~text
ACTIVE
  |
  | deactivate
  ↓
DEACTIVATED
  |
  | reactivate
  ↓
ACTIVE
~~~

This applies to entities such as:

- operators;
- routes;
- operator members/users;
- taxis.

Deactivation means:

> The entity remains historically known but is excluded from normal active operations.

---

# 16. Why deletion is restricted

Operational history has value.

If a taxi completed hundreds of trips, hard deletion can destroy the identity needed to interpret those trips.

Preferred model:

~~~text
Taxi ABC123
     ↓
active = 0
     ↓
Unavailable for new active operations
     ↓
Historical trips remain associated
~~~

The current E2E suite checks that destructive DELETE paths for core operator, route, taxi, and user resources are not exposed as normal operations.

Lifecycle operations use explicit status actions, for example:

~~~http
POST /api/operator/taxi/status

{
  "taxiId": "taxi_123",
  "active": false
}
~~~

---

# 17. Deactivation semantics

Deactivation may require dependent operational relationships to stop being active.

For a taxi:

~~~text
Deactivate Taxi
     |
     ├── taxi.active = 0
     ├── stop new active use
     ├── revoke relevant active assignments/authorizations
     ├── preserve historical trips
     └── write audit event
~~~

It must not silently erase:

- trips;
- audit records;
- route history;
- operator identity;
- historical relationships.

---

# 18. Auditability

Important changes should be traceable.

Audit records contain concepts such as:

~~~text
actor_user_id
operator_id
action
entity_type
entity_id
details_json
timestamp
~~~

Example:

~~~json
{
  "action": "TAXI_DEACTIVATED",
  "entityType": "taxi",
  "entityId": "taxi_123",
  "operatorId": "operator_123",
  "actorUserId": "user_456",
  "timestamp": 1234567890
}
~~~

This answers:

> Who changed what, when, and in which operational context?

---

# 19. Incidents and observability

Unexpected Worker errors should be recorded as incidents where possible.

However, incident persistence must not prevent the application from responding.

Desired model:

~~~text
Application error
      ↓
Attempt incident persistence
      ↓
If incident persistence fails/times out
      ↓
Still return controlled HTTP 500
~~~

Observability should improve reliability, not become another failure dependency.

---

# 20. Current architecture

TaxiConnect currently uses Cloudflare as the application platform.

~~~text
                    INTERNET
                       |
                       ↓
              +----------------+
              | Static frontend|
              | public/        |
              +----------------+
                       |
                       ↓
              +----------------+
              | Cloudflare     |
              | Worker         |
              | taxiconnect-api|
              +----------------+
                 |          |
                 ↓          ↓
              +-----+   +---------+
              | D1  |   |WebSocket|
              | DB  |   | realtime|
              +-----+   +---------+
~~~

Responsibilities:

| Layer | Technology | Responsibility |
|---|---|---|
| Frontend | HTML/CSS/JavaScript | Role-specific UI |
| API/runtime | Cloudflare Worker | Business rules, auth, authorization |
| Database | Cloudflare D1 | Persistent operational state |
| Realtime | WebSockets | Live event delivery |
| Deployment | Wrangler | Cloudflare deployment |
| CI/CD | GitHub Actions | Automated validation and E2E |

---

# 21. Firebase boundary

Firebase was part of the earlier architecture.

The current migration makes Cloudflare Worker + D1 the application runtime and removes Firebase from the current application runtime/deployment path.

Important distinction:

~~~text
Code no longer depends on Firebase
              ≠
External Firebase project can immediately be destroyed
~~~

An external service should only be decommissioned after production dependency verification.

---

# 22. API philosophy

API endpoints should express business operations.

Examples:

~~~text
POST /api/operator/taxi/create
POST /api/operator/taxi/status
POST /api/operator/taxi/assign-driver
POST /api/operator/taxi/authorize-route

POST /api/conductor/line/open
POST /api/conductor/line/add
POST /api/conductor/line/reorder
POST /api/conductor/line/remove
POST /api/conductor/summon

POST /api/driver/go-live
POST /api/driver/passengers
POST /api/driver/status

POST /api/passenger/waiting
POST /api/passenger/cancel-waiting
POST /api/passenger/demand
~~~

The client should not behave as if it can execute unrestricted database mutations.

Instead:

~~~text
Business request
     ↓
Worker validation
     ↓
Authorization
     ↓
State validation
     ↓
D1 mutation
     ↓
Audit/realtime where appropriate
~~~

---

# 23. Complete real-world scenario

Suppose a passenger wants to travel from Sun Village to Rustenburg.

### Step 1 — Select route

~~~text
Sun Village → Rustenburg
~~~

### Step 2 — Select pickup point

~~~text
Sun Village Rank
~~~

### Step 3 — Passenger indicates demand

~~~json
{
  "routeId": "sun-rustenburg",
  "pickupPointId": "sun-village-rank",
  "groupSize": 2
}
~~~

### Step 4 — Worker validates

The Worker checks:

- passenger identity;
- active route;
- pickup point;
- route relationship;
- group size;
- duplicate/idempotency conditions.

### Step 5 — Conductor sees demand

~~~text
Route: Sun Village → Rustenburg
Current indicated demand: 19 passengers
~~~

### Step 6 — Conductor manages line

~~~text
Taxi 101
Taxi 102
Taxi 103
Taxi 104
~~~

### Step 7 — Taxi is summoned

~~~text
Conductor
    ↓
Summon Taxi 101
~~~

### Step 8 — Driver goes live

The assigned driver starts the taxi's operational session.

### Step 9 — Passenger count changes

~~~text
0 → 2 → 7 → 12 → 15
~~~

### Step 10 — Taxi becomes full

~~~text
15 / 15
FULL
~~~

### Step 11 — Taxi departs

~~~text
FULL → DEPARTED
~~~

### Step 12 — Taxi arrives

~~~text
DEPARTED → ARRIVED
~~~

### Step 13 — History remains

The completed trip remains available to authorized operational/admin views.

### Step 14 — Audit remains

Relevant administrative and lifecycle changes remain traceable.

---

# 24. Core business invariants

These rules should remain true.

## Active operator

An inactive operator cannot participate in normal active operations.

## Active route

An inactive route cannot be used for new active route operations.

## Operator ownership

An operator administrator can only manage resources inside their authorized operator scope.

## Driver assignment

A driver can only operate a taxi assigned to them.

## Route authorization

A taxi must be authorized for the route before route operations begin.

## Capacity

~~~text
0 <= passengersOnboard <= taxi.capacity
~~~

## Trip state

Only permitted state transitions are allowed.

## Idempotency

Retrying a logical passenger request must not create uncontrolled duplicate demand.

## Historical integrity

Deactivation must not destroy historical operational meaning.

## Auditability

Important administrative/lifecycle changes should remain traceable.

---

# 25. Testing philosophy

Tests should prove business behaviour, not merely syntax.

The current platform E2E suite covers:

### Authentication
- Super Admin login;
- Operator Admin login;
- Driver login;
- Conductor login.

### Authorization
- role isolation;
- unauthenticated protection;
- operator boundaries.

### Administration
- operator creation;
- route creation;
- route authorization;
- operator-admin provisioning.

### Operator operations
- taxi creation;
- driver creation;
- conductor creation;
- route pickup points;
- driver assignment;
- taxi-route authorization.

### Conductor operations
- line session;
- taxi pool;
- add;
- reorder;
- remove;
- demand;
- statistics;
- summon.

### Passenger operations
- waiting;
- duplicate waiting/idempotency;
- cancellation;
- along-route waiting;
- collection waiting;
- demand;
- duplicate demand/idempotency;
- invalid same-point requests;
- invalid cross-route requests.

### Driver operations
- session;
- routes;
- go-live;
- passenger updates;
- full;
- departure;
- invalid transition;
- arrival.

### Lifecycle
- operator deactivate/reactivate;
- route deactivate/reactivate;
- member deactivate/reactivate;
- taxi deactivate/reactivate.

### Destructive safety
- DELETE safety checks.

### Audit
- lifecycle audit events.

### Realtime
- WebSocket connection;
- connected event;
- broadcast reception.

The principle is:

> **Every important business rule should have a test that proves the rule.**

---

# 26. Example invalid transition test

~~~javascript
await req(
  "driver invalid departed to loading rejected",
  "POST",
  "/api/driver/status",
  {
    token: DRV,
    expected: 409,
    body: {
      tripId: live.trip.id,
      status: "LOADING"
    }
  }
);
~~~

This proves the rule at the API level.

---

# 27. Example lifecycle test

~~~javascript
await req(
  "deactivate second taxi",
  "POST",
  "/api/operator/taxi/status",
  {
    token: OP,
    body: {
      taxiId: taxi2.taxi.id,
      active: false
    }
  }
);

await req(
  "reactivate second taxi",
  "POST",
  "/api/operator/taxi/status",
  {
    token: OP,
    body: {
      taxiId: taxi2.taxi.id,
      active: true
    }
  }
);
~~~

This proves that the record has a lifecycle rather than a one-way existence model.

---

# 28. Frontend intent

The UI should reflect what each role actually does.

## Passenger

~~~text
Where am I?
Where am I going?
Where am I waiting?
How many people?
Am I still waiting?
~~~

## Conductor

~~~text
Route
Demand
Taxi line
Taxi availability
Dispatch
~~~

## Driver

~~~text
My taxi
My route
Passenger count
Trip state
~~~

## Operator

~~~text
My operation
Taxis
Drivers
Conductors
Routes
Assignments
~~~

## Super Admin

~~~text
Platform
Operators
Routes
Users
Taxis
Trips
Incidents
Audit
Health
~~~

---

# 29. Development rule: do not code against the screen alone

Before implementing a feature, answer:

1. What business operation is this?
2. Which role performs it?
3. Which entity changes?
4. What state is it currently in?
5. What state should it become?
6. Who owns it?
7. What authorization is required?
8. Should it be audited?
9. Is it idempotent?
10. What happens on retry?
11. What happens when the entity is inactive?
12. What historical data must remain?
13. What E2E test proves it?

This keeps the application coherent as it grows.

---

# 30. Development rule: API is the security boundary

Do not rely on frontend logic such as:

~~~javascript
if (buttonIsVisible) {
  allowAction();
}
~~~

Instead:

~~~text
UI
 ↓
Authentication
 ↓
Role authorization
 ↓
Operator authorization
 ↓
Resource ownership
 ↓
State validation
 ↓
Database operation
~~~

---

# 31. Development rule: every important entity needs lifecycle semantics

When introducing a new entity, decide before implementing CRUD:

~~~text
Can it be deactivated?
Can it be reactivated?
What does active mean?
What happens to dependent records?
Should it be audited?
Is history required?
Should DELETE exist?
~~~

This is especially important for operational records.

---

# 32. Development rule: preserve historical meaning

Suppose Taxi ABC123 completed a trip.

Later the taxi is retired.

The completed trip should continue to mean:

~~~text
Trip
  Route = Sun Village → Rustenburg
  Taxi = ABC123
  Driver = Driver X
  Status = ARRIVED
~~~

The taxi being inactive today should not rewrite yesterday's history.

---

# 33. Development rule: realtime is not authoritative

Correct architecture:

~~~text
Authoritative state
       ↓
D1
       ├── API response
       └── WebSocket event
~~~

If a client disconnects, it can reconnect and read the authoritative state.

---

# 34. Development rule: D1 is the source of truth

Frontend state, browser state, caches, and WebSocket messages are representations.

D1 is the persistent operational source of truth for:

- trips;
- passenger demand;
- passenger waiting;
- taxi assignments;
- route authorization;
- line state;
- active/inactive state;
- audit.

---

# 35. Operational reporting intent

The platform should eventually answer:

- How many taxis operated today?
- Which routes were active?
- How many trips completed?
- How much demand was recorded?
- How many taxis were dispatched?
- Which taxis are active?
- Which operators are active?
- Which drivers are assigned?
- How many incidents occurred?
- What lifecycle changes happened?
- Who performed an administrative change?

This is why history and audit are first-class concepts.

---

# 36. Future demand analytics

The existing model supports future analytics such as:

~~~text
Demand by route
Demand by pickup point
Demand by time
Demand by request mode
Demand by group size
~~~

Example:

~~~text
08:00–09:00
Sun Village → Rustenburg

Pickup A: 18
Pickup B: 11
Pickup C:  4
----------------
Total:    33
~~~

Analytics should be derived from operational data.

---

# 37. Future dispatch assistance

The domain can support decision-support features.

For example:

~~~text
Demand = 28 passengers
Taxi capacity = 15
~~~

A simple capacity calculation is:

~~~text
ceil(28 / 15) = 2 taxis
~~~

Future software may surface operational information or suggestions based on such calculations.

The core system should still distinguish between information and authorized operational action.

---

# 38. Definition of success

The core end-to-end flow is:

~~~text
1. Operator exists
2. Route exists
3. Pickup points exist
4. Taxi exists
5. Driver exists
6. Driver is assigned to taxi
7. Taxi is authorized for route
8. Conductor opens line
9. Taxi enters line
10. Passenger indicates demand
11. Conductor sees demand
12. Taxi is summoned
13. Driver goes live
14. Passenger count changes
15. Taxi reaches full/loading state
16. Taxi departs
17. Taxi arrives
18. Trip remains in history
19. Important actions remain auditable
~~~

That sequence is the core product acceptance model.

---

# 39. Definition of operational safety

A safe implementation should make it difficult to accidentally:

- access another operator's resources;
- operate an inactive taxi;
- operate an unauthorized route;
- operate another driver's taxi;
- exceed taxi capacity;
- perform invalid trip transitions;
- create uncontrolled duplicate demand;
- permanently erase important history;
- make important administrative changes without traceability.

---

# 40. Future feature test

A proposed feature naturally belongs in TaxiConnect when it strengthens:

- transport coordination;
- demand visibility;
- dispatch;
- driver operations;
- fleet operations;
- route management;
- passenger experience;
- realtime operations;
- safety;
- auditability;
- historical reporting.

Examples that fit naturally:

- demand heatmaps;
- queue analytics;
- route performance;
- passenger wait-time reporting;
- occupancy reporting;
- driver availability;
- dispatch history;
- operational alerts;
- incident workflows;
- notifications;
- richer realtime events;
- offline-first workflows.

The architectural question should always be:

> **Does this feature support the route-based taxi operation represented by the core chain?**

---

# 41. Repository responsibilities

Conceptually:

~~~text
public/          = user interfaces
cloudflare/      = application platform
cloudflare/src/  = Worker/business logic
migrations/      = database evolution
tests/            = business verification
docs/             = product and technical intent
~~~

The preferred traceability is:

~~~text
Product intent
    ↓
Business rule
    ↓
API
    ↓
D1 state
    ↓
E2E test
~~~

Example:

~~~text
Intent:
A taxi cannot operate an unauthorized route.

Rule:
Taxi-route authorization is required.

API:
POST /api/driver/go-live

Data:
taxi_routes

Test:
authorized driver go-live
~~~

---

# 42. Core endpoint map

## Authentication

~~~text
POST /api/auth/login
~~~

## Health

~~~text
GET /api/health
~~~

## Passenger

~~~text
POST /api/passenger/waiting
POST /api/passenger/cancel-waiting
POST /api/passenger/demand
~~~

## Driver

~~~text
GET  /api/driver/session
GET  /api/driver/routes
POST /api/driver/go-live
POST /api/driver/passengers
POST /api/driver/status
~~~

## Conductor

~~~text
GET  /api/conductor/session
GET  /api/conductor/taxis
GET  /api/conductor/demand
GET  /api/conductor/stats
GET  /api/conductor/line

POST /api/conductor/line/open
POST /api/conductor/line/add
POST /api/conductor/line/reorder
POST /api/conductor/line/remove
POST /api/conductor/summon
~~~

## Operator

~~~text
GET  /api/operator/overview
GET  /api/operator/route-points

POST /api/operator/taxi/create
POST /api/operator/taxi/status
POST /api/operator/taxi/assign-driver
POST /api/operator/taxi/authorize-route

POST /api/operator/members/create
POST /api/operator/member/status
POST /api/operator/route-points
~~~

## Super Admin

~~~text
GET  /api/superadmin/dashboard
GET  /api/superadmin/operators
GET  /api/superadmin/routes
GET  /api/superadmin/users
GET  /api/superadmin/taxis
GET  /api/superadmin/trips
GET  /api/superadmin/audit
GET  /api/superadmin/incidents
GET  /api/superadmin/health

POST /api/superadmin/operator/create
POST /api/superadmin/operator/status
POST /api/superadmin/route/create
POST /api/superadmin/route/status
POST /api/superadmin/operator/authorize-route
POST /api/superadmin/operator-admin/create
~~~

## Realtime

~~~text
GET /ws
~~~

---

# 43. Business-rule checklist

Before merging a feature:

~~~text
[ ] Does it support TaxiConnect's transport-operations intent?
[ ] Which role performs the action?
[ ] Is authentication enforced?
[ ] Is role authorization enforced?
[ ] Is operator scoping enforced?
[ ] Is resource ownership enforced?
[ ] Is inactive-state behaviour defined?
[ ] Is the state transition valid?
[ ] Is capacity validated?
[ ] Is duplicate/retry behaviour defined?
[ ] Does the action need an audit record?
[ ] Does historical data need to remain?
[ ] Is destructive deletion really necessary?
[ ] Is realtime notification required?
[ ] Is D1 still the source of truth?
[ ] Is there an E2E test?
~~~

---

# 44. Final mental model

~~~text
                         TAXICONNECT
                              |
          +-------------------+-------------------+
          |                   |                   |
          ↓                   ↓                   ↓
      PASSENGERS          OPERATORS          PLATFORM
          |                   |                   |
          ↓                   ↓                   ↓
        DEMAND              FLEETS              ADMIN
          |                   |                   |
          +-------------------+-------------------+
                              |
                              ↓
                       ROUTE OPERATION
                              |
                    +---------+---------+
                    |                   |
                    ↓                   ↓
                CONDUCTOR            DRIVER
                    |                   |
                    ↓                   ↓
                TAXI LINE             TRIP
                    |                   |
                    +---------+---------+
                              |
                              ↓
                          DISPATCH
                              |
                              ↓
                         COMPLETION
                              |
                    +---------+---------+
                    |                   |
                    ↓                   ↓
                 HISTORY              AUDIT
~~~

The application exists to make this flow **coordinated, controlled, observable, persistent, and auditable**.

---

# 45. Final product statement

> **TaxiConnect is a route-based, demand-driven transport operations platform for minibus taxis. Passengers create transport demand; conductors manage demand and taxi lines; drivers operate assigned taxis and update trip state; operators manage fleets, people, and route authorizations; and Super Admins manage the platform. Cloudflare Worker provides the business/API layer, D1 provides persistent operational state, WebSockets provide realtime delivery, and lifecycle/audit rules preserve historical integrity.**

The primary architectural compass is:

~~~text
PASSENGER DEMAND
       ↓
ROUTE
       ↓
CONDUCTOR / LINE
       ↓
TAXI
       ↓
DRIVER
       ↓
TRIP
       ↓
COMPLETION
       ↓
HISTORY + AUDIT
~~~

> **Build TaxiConnect as a stateful, route-based, demand-driven, role-authorized, realtime, auditable transport-operations platform — not as a collection of unrelated CRUD screens.**
