# TaxiConnect — Cloudflare-only migration

## Decision

TaxiConnect's current application path is Cloudflare Worker + D1. The legacy Firebase implementation has been removed from this migration branch.

## Removed

- Firebase Hosting configuration
- Firebase Realtime Database rules
- Firebase Cloud Functions
- Firebase project configuration
- Firebase deployment commands
- Firebase-generated browser configuration
- Firebase SDK references from Driver and Conductor pages
- Legacy Firebase demo page
- Stale Flutter/Firebase project manifest

## Current request path

```
Browser
  |
  v
Cloudflare Worker
  |
  +--> D1
  |
  +--> WebSocket runtime
  |
  +--> static assets from /public
```

## Verification required before merging

1. Run the Cloudflare Worker locally.
2. Apply the local D1 migrations.
3. Run the existing platform E2E workflow/tests.
4. Verify Super Admin authentication and authorization.
5. Verify operator, route, user, taxi, trip and audit flows.
6. Verify Driver, Conductor and Passenger flows.
7. Verify waiting passengers, demand signals and dispatch.
8. Verify WebSocket/realtime behaviour.
9. Verify destructive-record lifecycle rules and audit logging.
10. Search the branch for remaining Firebase references before merging.

## Important

This code change removes the repository's Firebase runtime and deployment path. It does **not** delete or decommission the external Firebase project itself. Decommission that project separately only after confirming no other application, environment, backup, or operational process still depends on it.
