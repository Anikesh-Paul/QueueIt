# QueueIt

Virtual queues for campus services. People join a line from their phone, watch their place, and show up when it’s their turn. Staff run the counter from an admin console.

**Live app:** [queueit-seven.vercel.app](https://queueit-seven.vercel.app)

**Stack:** MongoDB · Express · React · Node · JWT (`user` | `admin`)

## What it does

### For people in line

- Browse the venue’s queues (Campus Hub — Cafeteria and Gym)
- Join without standing physically in line — or **continue as a guest**, no account required
- See **token**, **position**, **ETA** (campus clock, IST), and **now serving**
- Get a **near-front** prompt when you’re in the next three
- Show an **arrival pass** QR at the counter
- Leave if plans change; review **history** (portable after login)
- Optionally **register or log in** later — guest place and device history move onto the account

### For staff

- Waiting list with serve, skip, pause, and resume
- **Walk-in** tokens for people who arrive without the app
- **Start / stop accepting tokens**, **extend** a session, and **reset** the line
- Daily **service windows** (editable; auto-close at window end)
- **Check arrival** — camera scan or typed token
- **Analytics** — served count, wait times, busiest hours (IST)

### Live updates

Polling is always on. On a long-running API host (local or Render), **Socket.IO** pushes changes instantly. The Vercel serverless API cannot hold sockets; the UI shows polling there and never depends on realtime to work.

## Live deployment

| Surface | URL |
|---------|-----|
| Frontend | https://queueit-seven.vercel.app |
| Backend API | https://queueit-api.vercel.app |
| Health | https://queueit-api.vercel.app/api/health |

Demo logins are created from **host environment variables** (`SEED_*`). Passwords are never committed.

## Layout

```
.
├── client/          # React (Vite) frontend
├── server/          # Express API
├── e2e/             # Playwright smoke + feature specs
├── render.yaml      # Optional Render Blueprint for the API
└── package.json     # npm workspaces root
```

## Prerequisites

- Node.js 20+
- npm 10+
- MongoDB (local `mongod`, Docker, or Atlas)

## Setup

```bash
npm install

# Windows
copy server\.env.example server\.env
copy client\.env.example client\.env

# macOS / Linux
cp server/.env.example server/.env
cp client/.env.example client/.env
```

In `server/.env`:

1. Set `MONGODB_URI`.
2. Set a strong `JWT_SECRET`.
3. Set `SEED_*` emails and passwords for demo accounts. Do not commit them.

Seed demo user + admin, one venue, and two queues (idempotent):

```bash
npm run seed
```

| Venue | Queues |
|-------|--------|
| Campus Hub | Cafeteria (~3 min/serve), Gym (~5 min/serve) |

## Run locally

Two terminals. MongoDB must be reachable at `MONGODB_URI`.

```bash
# API — http://localhost:5000
npm run dev:server

# Client — http://localhost:5173
npm run dev:client
```

Health check: `GET /api/health` → `{"status":"ok","service":"queueit-server"}`.

### Auth API (smoke)

```bash
# Register (role is always user)
curl -s -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"student@example.com\",\"password\":\"password123\",\"name\":\"Student\"}"

# Login
curl -s -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"student@example.com\",\"password\":\"password123\"}"

# Current user (replace TOKEN)
curl -s http://localhost:5000/api/auth/me -H "Authorization: Bearer TOKEN"

# Admin-only probe (403 for user tokens; 200 for admin)
curl -s http://localhost:5000/api/admin/ping -H "Authorization: Bearer TOKEN"

# List queues
curl -s http://localhost:5000/api/queues -H "Authorization: Bearer TOKEN"

# Join a queue (replace QUEUE_ID)
curl -s -X POST http://localhost:5000/api/queues/QUEUE_ID/join \
  -H "Authorization: Bearer TOKEN"

# Poll live status
curl -s http://localhost:5000/api/queues/QUEUE_ID/status \
  -H "Authorization: Bearer TOKEN"
```

On Windows `cmd`, use `^` instead of `\` for line continuation.

## Demo accounts

Demo logins are **seeded from env**, not hard-coded in git.

| Role  | Env vars | Notes |
|-------|----------|--------|
| admin | `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Can call `/api/admin/*` |
| user  | `SEED_USER_EMAIL` / `SEED_USER_PASSWORD` | Cannot call admin routes |

Anyone can also register; new accounts are always `user`.

### Production demo accounts

1. On the **API host**, set `SEED_ADMIN_*`, `SEED_USER_*`, `MONGODB_URI`, `JWT_SECRET`, and `CLIENT_ORIGIN` (the production frontend origin).
2. Set `SEED_ON_BOOT=true` for the first deploy, or run `npm run seed` against production `MONGODB_URI` from a trusted machine. Seeding is idempotent (upsert by email/slug).
3. Share demo credentials privately — never in this repository.
4. After the first successful seed, set `SEED_ON_BOOT=false` so restarts only serve traffic.

Placeholder emails in `server/.env.example` are local templates only.

## Tests

### Server API

```bash
npm test
```

Uses in-memory MongoDB (`mongodb-memory-server`). No local `mongod` required.

Covers auth and role gates, seed, join / leave / status / history, admin control (serve, skip, pause, walk-in, reset, windows, analytics, QR verify), guest join and soft upgrade, Socket.IO room broadcasts, and CORS.

### Playwright

Requires local MongoDB on `127.0.0.1:27017`. The e2e script **wipe-seeds** only `queueit-e2e` (never the developer `queueit` database), then starts API `:5000` and Vite `:5173`.

```bash
# Smoke: login + queues list
npm run test:e2e

# Full browser suite
npx playwright test
```

Artifacts (gitignored): `playwright-report/index.html`, failure traces under `test-results/`.

## Environment

| File | Purpose |
|------|---------|
| `server/.env.example` | `PORT`, `HOST`, `MONGODB_URI`, `JWT_SECRET`, `CLIENT_ORIGIN`, `SEED_ON_BOOT`, `SEED_*` |
| `client/.env.example` | `VITE_API_URL` for API base URL |

Copy examples to `.env` locally. **Never commit `.env` or real secrets.**

### Production env

| Variable | Where | Purpose |
|----------|--------|---------|
| `MONGODB_URI` | API host | Atlas connection string |
| `JWT_SECRET` | API host | Strong random secret |
| `CLIENT_ORIGIN` | API host | Exact frontend origin(s), comma-separated if needed |
| `SEED_ON_BOOT` | API host | `true` once to upsert demo data |
| `SEED_ADMIN_*` / `SEED_USER_*` | API host | Demo logins (host-only) |
| `VITE_API_URL` | Frontend **build** env | Public API base URL (no trailing slash) |

CORS rejects browser calls if `CLIENT_ORIGIN` does not match the site origin exactly (scheme + host + port).

## Deploy

Suggested free-tier path:

### 1. MongoDB Atlas

1. Create a free cluster and database user.
2. Network access: allow the API host (or `0.0.0.0/0` if you accept that tradeoff).
3. Set the `mongodb+srv://…` URI only on the API host as `MONGODB_URI`.

### 2. Backend (Vercel from `server/`)

```bash
cd server
vercel --prod
```

Set on the project:

- `MONGODB_URI`, `JWT_SECRET`, `CLIENT_ORIGIN` (set after the frontend URL is known — redeploy the API if needed)
- `SEED_ON_BOOT=true`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_USER_EMAIL`, `SEED_USER_PASSWORD`
- Optional: `SEED_ADMIN_NAME`, `SEED_USER_NAME`, `JWT_EXPIRES_IN`

Confirm: `GET https://<api-host>/api/health` → `{"status":"ok","service":"queueit-server"}`.

**Alternative:** Render Blueprint — connect the repo and use root `render.yaml` (set secret env vars in the Render UI). Socket.IO works on Render; it does not on the Vercel serverless API.

### 3. Frontend (Vercel from `client/`)

```bash
cd client
vercel --prod
```

Build env:

- `VITE_API_URL=https://<your-api-host>` (must be present **at build time**)

Then set API `CLIENT_ORIGIN` to the production frontend origin and redeploy the API if CORS was wrong on first boot.

### 4. Smoke the live path

1. Open the frontend → log in as **user**.
2. Join a queue → confirm token, position, ETA, now serving.
3. In another browser or profile → log in as **admin** → serve / skip / pause-resume.
4. Confirm the user view updates within a few seconds.

Keep `.env` files gitignored. This README must not contain production passwords or Atlas credentials.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev:server` | Express with file watch |
| `npm run dev:client` | Vite dev server |
| `npm run start:server` | Express production start |
| `npm run build:client` | Production client build |
| `npm run seed` | Upsert demo accounts + Campus Hub / Cafeteria / Gym |
| `npm run seed:e2e` | Wipe + seed dedicated `queueit-e2e` DB |
| `npm test` | Server HTTP API tests |
| `npm run test:e2e` | Playwright smoke (login + queues list) |
