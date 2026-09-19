# TaxiConnect — Product Definition and Operational Model

## What TaxiConnect is
TaxiConnect is a multi-corridor digital coordination and dispatch platform for existing taxi operations.
It is not tied to one corridor and is not intended to replace taxi associations, operators, rank marshals, conductors or drivers. It provides the shared operational information layer for passenger demand, taxi availability, queue position, dispatch and trip progress.

## Core problem
Passengers can wait without reliable visibility into available taxis. Drivers can spend time roaming or looking for passengers because demand is not visible. Operators and rank staff can lack a shared, auditable picture of what is happening.
TaxiConnect converts that uncertainty into structured operational state.

## Core loop
1. Passenger creates a waiting/demand signal.
2. TaxiConnect aggregates demand by authorized route and pickup point.
3. Operational staff manage the loading line.
4. Drivers see demand on routes their taxi is authorized to operate.
5. A taxi enters the line and is dispatched.
6. The driver loads passengers and updates trip state.
7. The taxi departs and eventually arrives.
8. Operational history and audit records remain available.

## Multi-corridor model
A corridor is data, not application code. Multiple operators, routes, pickup points and taxi fleets can coexist. Driver demand visibility is restricted to routes reached through the taxi/operator authorization model.

## Role outcomes
- Passenger: request transport and see relevant operational availability.
- Driver: see assigned taxis, authorized routes and aggregated demand before entering the loading flow.
- Conductor: manage route demand, loading lines and authorized taxi dispatch.
- Operator Admin: manage members, taxis, route authorization and compliance metadata within the operator boundary.
- Super Admin: establish operators/routes and maintain platform-wide control-plane records.

## Compliance boundary
TaxiConnect tracks lightweight compliance metadata: driver licence number, PrDP number/category/expiry; operator operating licence number/expiry, tax-clearance status/expiry and association reference; taxi roadworthy/certificate-of-fitness reference, status and expiry.
It does not need to become a repository for full medical certificates, police-clearance records or document images.

## Demand intelligence
Driver demand is a first-class capability. The driver API returns authorized routes, pickup points, waiting passengers, active demand, combined demand, active trips and a simple demand level. These are operational signals, not guaranteed forecasts.

## Lifecycle and readiness
`active` remains an administrative lifecycle flag. Compliance is tracked separately so expiry does not destroy historical records. Enforcement can be introduced at operational gates without automatically deleting or deactivating the underlying entity.

## Identity boundary
The current PIN login remains a lightweight operational authentication mechanism. Compliance data must not be treated as proof of identity merely because it exists in D1. Stronger per-user credentials/identity verification is a separate security-hardening track.

## Business outcome
TaxiConnect succeeds when passengers spend less time waiting without information, drivers have actionable visibility into legitimate demand, operators have a shared operational picture, dispatch is traceable, and the same platform can be configured for additional corridors without code changes.
