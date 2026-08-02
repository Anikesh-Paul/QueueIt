# QueueIt (QIT)

Virtual queue management system for Summer School ’26 MERN evaluation.

**Stack:** MongoDB · Express · React · Node · JWT (`user` | `admin`)

## Layout

```
.
├── client/          # React (Vite) frontend — auth + queue list UI
├── server/          # Express API — auth, roles, seed venue/queues
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

## Tests

```bash
npm test
```

Server HTTP API tests use an in-memory MongoDB (`mongodb-memory-server`) — no local mongod required for CI/local unit runs.

Coverage for this phase:

- Register / login success and validation failures  
- User-scoped vs admin-scoped sessions  
- Unauthenticated → 401 on protected routes  
- User token → 403 on admin-only routes  
- Seeded accounts + password hashing (no plaintext storage)  
- Seeded venue + two queues (idempotent)  
- `GET /api/queues` requires auth and returns the catalog  
- Join queue → token, position, ETA, now serving; double-join 409; status poll  
- Playwright: smoke (login + queues) + ticket `05-join-queue-live-status`  

## Environment

| File | Purpose |
|------|---------|
| `server/.env.example` | `PORT`, `MONGODB_URI`, `JWT_SECRET`, `CLIENT_ORIGIN`, `SEED_*` |
| `client/.env.example` | `VITE_API_URL` for API base URL |

Copy examples to `.env` locally. **Never commit `.env` or real secrets.**

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

**In:** JWT auth (`user` \| `admin`), register/login, protected + admin-only API gates, env-based seed accounts, seeded venue + 1–2 queues, queue list, **join → token / position / ETA / now serving** with **polling** UI.

**Later tickets:** leave + history, admin serve/skip/pause, deploy, harden/Playwright expansion, stretch.

**Explicitly out:** Super Admin multi-venue management UI; Socket.IO on must-ship.
