# 🚕 TaxiConnect

Demand-driven taxi dispatch system connecting Sun City and Rustenburg.

## Current architecture

TaxiConnect uses **Cloudflare Workers + D1** as its application platform.

- **Frontend:** static HTML/CSS/JavaScript in `public/`
- **API/runtime:** Cloudflare Worker in `cloudflare/src/index.js`
- **Database:** Cloudflare D1
- **Realtime:** Cloudflare WebSockets
- **Deployment:** Wrangler
- **CI/CD:** GitHub Actions

Firebase is no longer part of the application runtime or deployment path.

## Quick start

```bash
git clone https://github.com/Christopher-Mokolare/taxiconnect.git
cd taxiconnect

npm run build

cd cloudflare
npm install
npm run dev
```

## Deploy

Authenticate Wrangler with your Cloudflare account, then:

```bash
npm run deploy
```

or from the repository root:

```bash
npm run deploy
```

The Worker configuration is in `cloudflare/wrangler.jsonc`. Database migrations are stored in `cloudflare/migrations/`.

## Architecture and lifecycle documentation

See `docs/` for the system architecture, data lifecycle, deployment, and operational documentation.
