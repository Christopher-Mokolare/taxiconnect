# TaxiConnect Production Deployment

TaxiConnect production runs on Cloudflare Workers + D1. Firebase is not part of the runtime.

## GitHub Actions

The production deployment workflow is `.github/workflows/production-deploy.yml`.

It is intentionally **manual** (`workflow_dispatch`) so a normal push to `main` cannot unexpectedly deploy production.

The workflow:

1. Checks out `main`.
2. Installs the pinned Wrangler version.
3. Validates `cloudflare/src/index.js`.
4. Applies pending D1 migrations to the remote `taxiconnect` database.
5. Deploys the Worker and static assets using the `production` environment.
6. Prints the latest Worker deployment record.

## Required GitHub secret

Configure this repository secret:

- `CLOUDFLARE_API_TOKEN`

The token must be allowed to deploy the Worker and manage the `taxiconnect` D1 database in account `bb3ec8cb5cabb7e1e726497329756e7b`.

Do not commit Cloudflare tokens or application PINs to the repository.

## Required production Worker secrets

The Worker expects these production secrets:

- `SESSION_SECRET`
- `DRIVER_PIN`
- `CONDUCTOR_PIN`
- `OPERATOR_ADMIN_PIN`
- `SUPERADMIN_PIN`

These are Cloudflare Worker secrets, not GitHub repository files.

## Production bootstrap order

Use this order for a new production environment:

1. Deploy the Worker with the production deployment workflow.
2. Apply/verify D1 migrations.
3. Run `TaxiConnect Production Bootstrap` to provision the first active Super Admin.
4. Log in as Super Admin.
5. Create the first operator/association.
6. Authorize the operator for the required route.
7. Create the route and pickup points.
8. Provision Operator Admin membership.
9. Create drivers and conductors.
10. Create taxis.
11. Assign drivers to taxis.
12. Authorize taxis for routes.
13. Open the daily loading line.
14. Add taxis to the line.
15. Run the production smoke/E2E flow.

## Production verification

At minimum verify:

- `/api/health`
- Super Admin login
- Operator Admin login
- Driver login
- Conductor login
- Passenger flow
- operator scoping
- route authorization
- taxi/driver assignment
- daily line creation and ordering
- passenger waiting/idempotency
- demand/idempotency
- dispatch/summon
- trip capacity
- trip status transitions
- WebSocket updates
- audit records
- deactivate/reactivate lifecycle
- DELETE safety
- historical trip retention

## Firebase decommissioning

Do not delete the Firebase project solely because the repository no longer uses Firebase.

Before decommissioning Firebase:

1. Verify the production Worker serves the application and API.
2. Verify the production frontend contains no Firebase runtime dependency.
3. Verify production traffic is using Cloudflare.
4. Keep Firebase available through the verification window.
5. Only then disable/decommission the old Firebase resources.

## Important limitation

The GitHub integration can modify and verify repository state, but Cloudflare account control-plane access is not available from this environment. Therefore a production deployment must be started from GitHub Actions by an account owner/maintainer with the configured Cloudflare secret.
