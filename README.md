# 🚕 TaxiConnect

Demand-driven taxi dispatch system connecting Sun City and Rustenburg.

## Current architecture

TaxiConnect now uses **Cloudflare Workers + D1** as the primary application platform.

- **Frontend:** static HTML/CSS/JavaScript in `public/`
- **API/runtime:** Cloudflare Worker in `cloudflare/src/index.js`
- **Database:** Cloudflare D1
- **Realtime:** Cloudflare WebSocket handling
- **Deployment:** Wrangler

Firebase is no longer part of the application runtime or deployment path.

## Quick start

```bash
npm install
npm run build

cd cloudflare
npm install
npm run dev
```

## Deploy

Authenticate Wrangler with your Cloudflare account, then:

```bash
cd cloudflare
npm run deploy
```

The production deployment is defined by `cloudflare/wrangler.jsonc` and the GitHub Actions workflows under `.github/workflows/`.

## Architecture documentation

See the `docs/` directory for system architecture, data lifecycle, deployment, and operational documentation.
