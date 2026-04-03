# Solar Buddy Frontend

Modern Vite/React frontend for the solar estimate flow.

## Canonical Repo

This repository is the canonical Solar Buddy frontend.
If a sibling `solar-potential-frontend` directory exists in the workspace, treat it as legacy and
ignore it for current frontend changes.

## Run

1. Install dependencies:

```bash
npm install
```

2. Point the app at the backend:

```bash
cp .env.example .env.local
```

3. Start the dev server:

```bash
npm run dev
```

The app expects the backend API at `VITE_API_BASE_URL`.
If `VITE_API_BASE_URL` is left unset, the app uses same-origin `/api`, and Vite proxies those
requests to `http://localhost:8000` during local development so the deployed path and local path
match.

## Demo Mode

Set `VITE_DEMO_MODE=true` in local development if you want the app to return mock solar data without a running backend.

## Analytics

Google Analytics is currently loaded from the hardcoded GA4 snippet in
`solar-buddy-frontend/index.html` using measurement ID `G-SZRJSTZBSV`.

## Container Deploy

This frontend now includes a production `Dockerfile` and nginx runtime config support. See [RUNBOOK.md](/Users/benjaminlagrone/Documents/projects/solar-potential/RUNBOOK.md) for the Contabo deployment path and domain-pointing steps.
