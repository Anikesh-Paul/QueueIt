# QueueIt (QIT)

Virtual queue management system for Summer School ’26 MERN evaluation.

**Stack:** MongoDB · Express · React · Node · JWT (`user` | `admin`)

**Must-ship status:** Deployed and evaluation-ready (auth, user queue lifecycle, admin control, polling live status). Stretch features are optional and ordered — see [Current scope](#current-scope).

## Live deployment

| Layer | Host (example) | Notes |
|-------|----------------|-------|
| Database | MongoDB Atlas | Hosted cluster; `MONGODB_URI` on the API host only |
| Backend | Vercel (or Render) | Public API; health at `/api/health` |
| Frontend | Vercel | Static Vite build; `VITE_API_URL` points at the API |

Production URLs (no secrets):

| Surface | URL |
|---------|-----|
| Frontend | https://queueit-seven.vercel.app |
| Backend API | https://queueit-api.vercel.app |
| Health | https://queueit-api.vercel.app/api/health |

**Demo accounts** are created from **host environment variables** (`SEED_*`) — passwords are **never** committed. See [Production demo accounts](#production-demo-accounts).

**Panel demo:** step-by-step dual-browser script → **[DEMO.md](./DEMO.md)** (user join → admin serve/skip/pause → user updates).

## Layout

```
.
├── client/          # React (Vite) frontend — auth + queue UI
├── server/          # Express API — auth, queues, admin control
├── e2e/             # Playwright: smoke + per-ticket specs
├── DEMO.md          # Live evaluation demo script (locked agenda)
├── render.yaml      # Optional Render Blueprint for the API
├── playwright.config.mjs
├── package.json     # npm workspaces root
└── README.md
```

## Prerequisites

- Node.js 20+
- npm 10+
- MongoDB (local `mongod`, Docker, or Atlas) for running the server

## Setup

```bash
# Install all workspace dependencies
npm install

# Copy env templates (no secrets in the repo)
copy server\.env.example server\.env
copy client\.env.example client\.env
```

On macOS/Linux use `cp` instead of `copy`.

Edit `server/.env`:

1. Set `MONGODB_URI` to your database.
2. Set a strong `JWT_SECRET`.
3. Set `SEED_*` emails/passwords for demo accounts (your choice — do not commit them).

Seed demo user + admin, one venue, and two queues (idempotent):

```bash
npm run seed
```

Seeded catalog (deterministic, not multi-venue admin UI):

| Venue | Queues |
|-------|--------|
| Campus Hub | Cafeteria (~3 min/serve), Gym (~5 min/serve) |

## Run locally

Two terminals (MongoDB must be reachable at `MONGODB_URI`):

```bash
# API — http://localhost:5000
npm run dev:server

# Client — http://localhost:5173
npm run dev:client
```

### Auth API (smoke)

```bash
# Register a student (always role: user)
curl -s -X POST http://localhost:5000/api/auth/register ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"student@example.com\",\"password\":\"password123\",\"name\":\"Student\"}"

# Login
curl -s -X POST http://localhost:5000/api/auth/login ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"student@example.com\",\"password\":\"password123\"}"

# Current user (replace TOKEN)
curl -s http://localhost:5000/api/auth/me -H "Authorization: Bearer TOKEN"

# Admin-only probe (403 for user tokens; 200 for admin)
curl -s http://localhost:5000/api/admin/ping -H "Authorization: Bearer TOKEN"

# List available queues (401 without token; 200 with any valid session)
curl -s http://localhost:5000/api/queues -H "Authorization: Bearer TOKEN"

# Join a queue (replace QUEUE_ID) — returns tokenNumber, position, etaMinutes, nowServing
curl -s -X POST http://localhost:5000/api/queues/QUEUE_ID/join -H "Authorization: Bearer TOKEN"

# Poll live status while waiting
curl -s http://localhost:5000/api/queues/QUEUE_ID/status -H "Authorization: Bearer TOKEN"
```

Health check: `GET /api/health` → `{"status":"ok","service":"queueit-server"}`.

**ETA:** `position × averageServiceTime` (minutes). Live updates use **polling** (no Socket.IO on the must-ship path).

## Demo accounts

Demo logins are **seeded from env**, not hard-coded secrets in git.

| Role  | Env vars | Notes |
|-------|----------|--------|
| admin | `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Admin-scoped JWT; can call `/api/admin/*` |
| user  | `SEED_USER_EMAIL` / `SEED_USER_PASSWORD` | User-scoped JWT; cannot call admin routes |

Use those credentials on the login screen after `npm run seed`. Students may also self-register (always `user` role).

### Production demo accounts

1. On the **API host** dashboard, set `SEED_ADMIN_*`, `SEED_USER_*`, `MONGODB_URI`, `JWT_SECRET`, and `CLIENT_ORIGIN` (production frontend origin).
2. Set `SEED_ON_BOOT=true` for the first deploy (or run `npm run seed` against production `MONGODB_URI` from a trusted machine). Seeding is **idempotent** (upsert by email/slug).
3. Share demo email/password with the evaluator **out of band** (panel brief, private note) — **not** in this repository.
4. After the first successful seed, you may set `SEED_ON_BOOT=false` so restarts only serve traffic.

Placeholder emails in `server/.env.example` are local templates only.

## Tests

### Server HTTP API (supporting seam)

```bash
npm test
```

Uses an in-memory MongoDB (`mongodb-memory-server`) — no local mongod required for unit/API runs.

Coverage:

- Register / login success and validation failures  
- User-scoped vs admin-scoped sessions  
- Unauthenticated → 401 on protected routes  
- User token → 403 on admin-only routes  
- Seeded accounts + password hashing (no plaintext storage)  
- Seeded venue + two queues (idempotent)  
- `GET /api/queues` requires auth and returns the catalog  
- Join queue → token, position, ETA, now serving; double-join 409; status poll  
- Leave queue → frees slot, position advances; re-join issues a new token  
- User history → joined / left / served / skipped events for the authenticated user  
- Admin serve / skip / pause / resume + waiting list  
- Admin walk-in / reset / analytics (stretch)
- CORS: single/multi origin + preflight for production `CLIENT_ORIGIN`

### Playwright (primary product acceptance seam)

Requires local MongoDB on `127.0.0.1:27017`. The e2e script **wipe-seeds** only `queueit-e2e` (never the developer `queueit` DB), then starts API `:5000` + Vite `:5173`.

```bash
# Shared smoke: login + queues list
npm run test:e2e

# Evaluation must-ship path (smoke + ticket 09)
npm run test:e2e -- e2e/tickets/09-harden-playwright-readme

# Per-feature tickets (also run after related UI changes)
npm run test:e2e -- e2e/tickets/05-join-queue-live-status
npm run test:e2e -- e2e/tickets/06-leave-queue-history
npm run test:e2e -- e2e/tickets/07-admin-serve-skip-pause

# Full suite under e2e/
npx playwright test
```

Playwright covers (browser-visible + critical API checks):

| Flow | What is asserted |
|------|------------------|
| User happy path | Login → list → join → token / position / ETA / now serving → leave → history |
| Admin happy path | Login → waiting list → serve / skip / pause-resume |
| Cross-actor | Admin serve reflected on user view within the poll window |
| Role boundaries | 401 unauthenticated; 403 user on admin routes; bad login error in UI |

Artifacts (gitignored): `playwright-report/index.html`, failure traces under `test-results/`.

## Environment

| File | Purpose |
|------|---------|
| `server/.env.example` | `PORT`, `HOST`, `MONGODB_URI`, `JWT_SECRET`, `CLIENT_ORIGIN`, `SEED_ON_BOOT`, `SEED_*` |
| `client/.env.example` | `VITE_API_URL` for API base URL |

Copy examples to `.env` locally. **Never commit `.env` or real secrets.**

### Production env checklist

| Variable | Where | Purpose |
|----------|--------|---------|
| `MONGODB_URI` | API host | Atlas connection string |
| `JWT_SECRET` | API host | Strong random secret |
| `CLIENT_ORIGIN` | API host | Exact frontend origin(s), comma-separated if needed |
| `SEED_ON_BOOT` | API host | `true` once to upsert demo data |
| `SEED_ADMIN_*` / `SEED_USER_*` | API host | Demo logins (host-only) |
| `VITE_API_URL` | Frontend **build** env | Public API base URL (no trailing slash) |

CORS rejects browser calls if `CLIENT_ORIGIN` does not match the site origin exactly (scheme + host + port).

## Deploy (Phase 3 — must-ship)

Suggested free-tier path (brands may vary):

### 1. MongoDB Atlas

1. Create a free cluster and database user.
2. Network access: allow the API host (or `0.0.0.0/0` for student demos).
3. Copy the `mongodb+srv://…` URI — set it only on the API host as `MONGODB_URI`.

### 2. Backend (Vercel from `server/`)

```bash
# From repo root after vercel login
cd server
vercel --prod
```

Set project env in the Vercel dashboard (or `vercel env add`):

- `MONGODB_URI`, `JWT_SECRET`, `CLIENT_ORIGIN` (set after FE URL is known — redeploy API if needed)
- `SEED_ON_BOOT=true`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_USER_EMAIL`, `SEED_USER_PASSWORD`
- Optional: `SEED_ADMIN_NAME`, `SEED_USER_NAME`, `JWT_EXPIRES_IN`

Confirm: `GET https://<api-host>/api/health` → `{"status":"ok","service":"queueit-server"}`.

**Alternative:** Render Blueprint — connect the GitHub repo and use root `render.yaml` (set secret env vars in the Render UI).

### 3. Frontend (Vercel from `client/`)

```bash
cd client
vercel --prod
```

Build env:

- `VITE_API_URL=https://<your-api-host>` (must be present **at build time** for Vite)

Then set API `CLIENT_ORIGIN` to the production frontend origin (e.g. `https://queueit-….vercel.app`) and redeploy the API if CORS was wrong on first boot.

### 4. Smoke the live demo path

Follow **[DEMO.md](./DEMO.md)** for the full dual-browser agenda. Quick check:

1. Open the frontend URL → login as **user** (seed credentials from host env).
2. Join a queue → confirm token, position, ETA, now serving (polling).
3. In another browser/profile → login as **admin** → serve / skip / pause-resume.
4. Confirm the user view updates within a few seconds.

### 5. GitHub

Push FE + BE source. Keep `.env` files gitignored. README must not contain production passwords or Atlas credentials.

## Internship report

The LaTeX report and PDF are **local-only** (gitignored `report/`). Submit the compiled PDF (or college print package) to the evaluation authority — not via this GitHub repository.

## Scripts (root)

| Script | Description |
|--------|-------------|
| `npm run dev:server` | Express with file watch |
| `npm run dev:client` | Vite dev server |
| `npm run start:server` | Express production start |
| `npm run build:client` | Production client build |
| `npm run seed` | Upsert demo accounts + Campus Hub / Cafeteria / Gym |
| `npm run seed:e2e` | Wipe + seed dedicated `queueit-e2e` DB (never developer `queueit`) |
| `npm test` | Server HTTP API tests |
| `npm run test:e2e` | Playwright smoke (login + queues list) |
| `npm run test:e2e -- e2e/tickets/<NN>-<slug>` | Smoke + ticket-owned Playwright specs |

## Current scope

**Must-ship (done):** JWT auth (`user` \| `admin`), register/login, protected + admin-only API gates, env-based seed accounts, seeded venue + 1–2 queues, queue list, **join → token / position / ETA / now serving** with **polling** UI (loading/error states), **leave**, **user history**, **admin serve / skip / pause-resume**, **deployed** FE + API + Atlas, README + **[DEMO.md](./DEMO.md)**, Playwright evaluation gate (`e2e/smoke` + tickets `05`–`07` + `09`).

**Stretch shipped:** admin **walk-in** (counter arrival without app join — name + optional manual token; appears on waiting list; serve/skip), admin **reset queue** (end-of-session / day close — clears the waiting list, restarts tokens, re-opens the queue), the user **top-3 near-front banner** (when a user's position is 1–3 the live status shows an amber “You're next / near the front” banner telling them to approach the counter; hidden beyond position 3 and while the queue is paused — rule: `position ≤ 3`, position 1 = front of waiting line), and the admin **analytics page** (`GET /api/admin/queues/:queueId/analytics` — served count, average + longest wait in minutes, and a simple throughput peak: the top 3 busiest hours by serves, UTC; reachable via the admin console's **Analytics** button). Remaining order: QR → Socket.IO last.

**Explicitly out:** Super Admin multi-venue management UI; product push/SMS/email; guest mode; ratings; PWA/offline; Socket.IO on the must-ship path.
