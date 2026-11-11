# QueueIt

Virtual queues for campus services. People join a line from their phone, watch their place, and show up when it’s their turn. Staff run the counter from an admin console.

**Live app:** [queueit-seven.vercel.app](https://queueit-seven.vercel.app)

**Stack:** MongoDB · Express · React · Node · JWT (`user` | `admin`)

## What it does

### For people in line

- Browse the venue’s queues (Campus Hub — Cafeteria and Gym)
- Join without standing physically in line — or **continue as a guest**, no account required
- See **token**, **position**, **ETA** (campus clock, IST), and **now serving** (including the counter, when a queue has more than one)
- Get a **near-front** prompt when you’re in the next three
- Show an **arrival pass** QR at the counter
- Leave if plans change; review **history** (portable after login)
- Open a **poster join link** (`/join/:queueId`) from a shared QR — no need to browse the catalog first
- **Add to Home Screen** (web app manifest + theme color) on a phone
- Optionally **register or log in** later — guest place and device history move onto the account

### For staff

- Waiting list with serve, skip, pause, and resume — **call/serve can target a counter** when a queue has more than one
- **Catalog** — add, rename, or archive venues and queues without re-seeding; optional **max waiting** cap (catalog shows Full; join and walk-in return 409 at capacity); **no-show window** of 1–30 minutes (default 5) for the called-person timer, with an optional **dynamic** mode that scales to recent arrival times, queue length, and counter pace and is clamped to admin min/max (staff see the computed window)
- **I'm here** — a called student can check in from the status page. That flags the serving row for staff and **stops the no-show auto-skip** for that call (the deadline is cleared). Staff can still serve or skip manually. The action is idempotent.
- **Missed-turn recovery** — a skipped (no-show) student can rejoin once within a per-queue window (default **15 minutes**, admin-editable). They are reinserted **N places behind** the current serving point (default **2**, admin-editable) without jumping people already in those places. A second miss is final, and anyone who manually left cannot recover. Staff see a **Returning** tag; the audit log records the rejoin.
- **Priority lanes** — staff can mark a waiting person as priority (accessibility, pregnancy, medical/urgent, or other), and students can request the same for staff approval. Pending or rejected requests do not jump the line. At most every **Kth** serve may be priority (default **3**, admin-editable; **1** means no cap) so the regular line is not starved. Staff see a **Priority** tag; the audit log records marks, requests, and decisions.
- **Smart routing** — admins can group same-venue queues as **equivalent**. The catalog and join pages suggest a shorter open equivalent (“A shorter line is open at {name}”) without moving anyone automatically. On a multi-counter queue, Call next is assigned to the idle counter that has waited longest, not always Counter 1; staff can still pick a counter.
- **Best time to come** — historical joins are bucketed by weekday and hour in campus **IST**. When there is enough variation, the catalog and join pages show “Usually quiet around X”; otherwise the student hint is hidden. Admin analytics includes a 7×24 busyness chart and the same quiet-hour hint, or “Not enough history yet”.
- **Admin audit log** — pause, resume, skip, serve, call, reset, start/stop accepting, window edits, staff invites, and queue setting changes (including the waiting cap) are recorded with who / what / when. Staff can only read logs for their venue. Events are paginated and expire after **90 days**. The admin console shows the recent activity for that queue (campus IST).
- **Student language** — catalog, join, status, history, auth, and notifications can be viewed in **English** (default) or **Hindi**. A language toggle in the header persists on the device. If no preference is stored, a Hindi browser/OS language can select Hindi first. Admin copy stays English in this release.
- **Venue-scoped staff** — a staff account only manages its assigned venue, and can optionally be limited to specific queues in that venue (an empty allow-list still means every queue there). The seeded demo admin stays global and can **invite staff** from the catalog (name, email, venue, optional queues, optional temporary password or a reset link) and later edit that allow-list
- **Walk-in** tokens for people who arrive without the app
- **Start / stop accepting tokens**, **extend** a session, and **reset** the line
- **Service windows** in campus IST (editable; optional day-of-week scope; auto-close at window end)
- **Check arrival** — camera scan or typed token
- **Poster QR** — print or copy a join link for this queue (not an arrival pass)
- **Analytics** — served count, wait times, busiest hours (IST)

### Live updates

Polling backs the live student status and the admin waiting list. When the tab is visible and no socket is connected, it runs every **3 seconds**. When Socket.IO is connected it slows to **15 seconds** (the socket stays the fast path). Hidden tabs do not poll, and a refresh runs when the tab becomes visible again.

Instant updates need a **long-running API process** (`Socket.IO`). The Vercel serverless API cannot hold sockets, so the production app stays on the 3-second poll and never depends on realtime to work. The 15-second session closer also does not run on serverless; sessions still close lazily on the next request. Even on a long-running host, **guests keep polling** until guest socket auth exists — today's handshake is JWT-only (`auth.token`). See [How to run the API as a long-running process for Instant updates](#how-to-run-the-api-as-a-long-running-process-for-instant-updates).

History is paginated (default **20** events, max 50, newest first, `cursor` + `hasMore`). Admin analytics can be scoped with `?window=today` (campus IST day) or `from` / `to` ISO instants; waiting count stays live. The default (no query) is all-time, which is what existing clients get. Campus rollup lives at `/admin/analytics` (`GET /api/admin/analytics` and `/api/admin/analytics.csv`). Staff see only their venue; global admins can filter by `venueId`. The CSV is a per-queue rollup plus a Totals row — no student names or emails.

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
├── e2e/             # Playwright smoke
└── package.json     # npm workspaces root
```

Visual tokens (palette, type, radius, elevation) are documented in [DESIGN.md](./DESIGN.md).

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

Seed demo user + admin, one venue, and two queues (idempotent). Re-running seed updates demo account passwords, but does **not** overwrite live catalog names, service pace, no-show minutes, service windows, pause/closed state, or token counters. Set `SEED_RESET_CATALOG=true` only if you intentionally want default windows and `open` status restored:

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
2. Set `SEED_ON_BOOT=true` for the first deploy, or run `npm run seed` against production `MONGODB_URI` from a trusted machine. Seeding is idempotent (upsert by email/slug) and no longer overwrites admin-edited names, service pace, no-show minutes, windows, or a paused/closed queue. Use `SEED_RESET_CATALOG=true` only for an intentional demo reset of those fields.
3. Share demo credentials privately — never in this repository.
4. After the first successful seed, set `SEED_ON_BOOT=false` so restarts only serve traffic.

Placeholder emails in `server/.env.example` are local templates only.

## Tests

```bash
npm test
npm run lint
```

`npm test` runs the server HTTP API suite and the client unit tests (`client/src/lib/*.test.js`). Server tests use in-memory MongoDB (`mongodb-memory-server`); no local `mongod` is required. They cover auth and role gates, seed, join / leave / status / history, admin control (serve, skip, pause, walk-in, reset, windows, analytics, QR verify), guest join and soft upgrade, Socket.IO room broadcasts, and CORS.

`npm run lint` runs ESLint over the client and server (ESLint 9). A GitHub Actions workflow that runs lint, `npm test`, and `npm run build:client` on pull requests and pushes to `main` can be added later (the workflow file is ready locally, but is not in the repo yet). Playwright stays a separate, manual job (`npm run test:e2e`) because it needs a local MongoDB.

### Playwright

Requires local MongoDB on `127.0.0.1:27017`. The e2e script **wipe-seeds** only `queueit-e2e` (never the developer `queueit` database), then starts API `:5000` and Vite `:5173`.

```bash
npm run test:e2e
```

Artifacts (gitignored): `playwright-report/index.html`, failure traces under `test-results/`.

## Environment

| File | Purpose |
|------|---------|
| `server/.env.example` | `PORT`, `HOST`, `MONGODB_URI`, `JWT_SECRET`, `ARRIVAL_PASS_SECRET`, `CLIENT_ORIGIN`, `SEED_ON_BOOT`, `SEED_*`, optional `SMTP_*` / `PASSWORD_RESET_EXPIRES_MINUTES` |
| `client/.env.example` | `VITE_API_URL` for API base URL |

Copy examples to `.env` locally. **Never commit `.env` or real secrets.**

### Production env

| Variable | Where | Purpose |
|----------|--------|---------|
| `MONGODB_URI` | API host | Atlas connection string |
| `JWT_SECRET` | API host | Strong random secret |
| `ARRIVAL_PASS_SECRET` | API host | Optional. HMAC key for signed arrival passes; falls back to `JWT_SECRET` |
| `ALLOW_UNSIGNED_ARRIVAL` | API host | Optional. Set to `1` to accept legacy unsigned `QIT:` passes and typed token numbers at verify. Default off. |
| `CLIENT_ORIGIN` | API host | Exact frontend origin(s), comma-separated if needed |
| `SEED_ON_BOOT` | API host | `true` once to upsert demo data |
| `SEED_ADMIN_*` / `SEED_USER_*` | API host | Demo logins (host-only) |
| `VITE_API_URL` | Frontend **build** env | Public API base URL (no trailing slash) |
| `PASSWORD_RESET_EXPIRES_MINUTES` | API host | Optional. How long a reset link lasts (default 60). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | API host | Optional. Reserved for a real mail transport. Unset by default — no paid provider is enabled. |

CORS rejects browser calls if `CLIENT_ORIGIN` does not match the site origin exactly (scheme + host + port).

The login page includes **Forgot password?**. `POST /api/auth/forgot-password` always returns a generic success message, so it does not reveal whether an email is registered. Reset tokens are stored as SHA-256 hashes, expire (default 60 minutes), and can be used only once. A successful `POST /api/auth/reset-password` sets the new password, invalidates the token, and signs the user in. In development, and whenever no mail transport is plugged in, the reset link is written to the server log (`[queueit-mailer] Password reset for …`) and the mailer does not throw. To send real mail later, set `SMTP_*` on the API host and supply a transport — do not commit secrets, and do not enable a paid provider by default.

The API also applies Helmet security headers, a 16kb JSON body cap, and per-IP rate limits on `POST /api/auth/login`, `POST /api/auth/register`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`, and `POST /api/queues/:id/join`. Register and login reject invalid emails, passwords outside 8–128 characters (register also enforces a minimum of 8), and names longer than 80 characters. Do not set `trust proxy` unless the process is behind a known reverse proxy; rate limits are keyed by the direct client IP.

Guest credentials are minted as high-entropy secrets and returned once to the device. Mongo stores only a SHA-256 hash; a presented header is hashed and compared (legacy plaintext rows are re-hashed on use or at boot). The browser keeps the raw Guest credential and JWT in `localStorage`, which is convenient on this device but means any XSS can steal the session. Prefer fixing XSS over treating `localStorage` as a vault; moving to httpOnly cookie sessions would be a separate migration.

Runtime API packages are pinned past known advisories (`mongoose` 9.12.x, `express` 4.22.3, plus overrides for `body-parser`, `engine.io`, `qs`, `proxy-addr`, and `ip-address`). `npm audit --omit=dev` is clean. Remaining `npm audit` findings live in dev/CLI trees (`vercel`, `shadcn`, and their `zod` / `tar` / `undici` dependents), not the production server or client bundle. `vercel` and `shadcn` are devDependencies only.

The arrival-pass QR confirms that a token is waiting in a queue — it is a counter convenience, not proof of identity. Join and status issue a signed pass (`QIT:<queueId>:<tokenNumber>:<mac>`), HMAC-SHA256 with `ARRIVAL_PASS_SECRET` or, if that is unset, `JWT_SECRET`. Admin verify accepts only a signed pass by default. A tampered MAC is rejected. Legacy unsigned `QIT:` passes and typed token numbers are rejected unless `ALLOW_UNSIGNED_ARRIVAL=1` is set on the API host.

## Notifications

The live-status page can request the browser **Notification** permission and fire a one-shot alert when a student enters the top-3 (near the front), becomes next, or — if the status API still shows it — when their token is now serving. Polls do not re-notify the same state. Paused queues do not tell people to approach the counter. Optional sound and vibrate are user-controlled. Declining permission leaves the in-page banner working. On a closed or not-yet-open catalog or join card, students and guests can also ask to be notified when the queue starts accepting tokens again (scheduled windows or staff start-accepting). That watch is stored in the browser and polled while this tab is open; there is no push/VAPID in this release. If notification permission is denied, the request quietly does nothing.

These alerts only work while the QueueIt tab is open (including in the background). They do **not** arrive after the tab or browser is killed.

## Poster join and install

Staff can reveal a **poster QR** on the admin console and copy a join link (`/join/:queueId`). Scanning it on a phone opens that queue’s join action for a guest or a signed-in user, or explains why the line is closed. The QR encodes the app URL, not an arrival pass (`QIT:…`). A compact `QITJ:<queueId>` payload is also accepted if someone pastes it by hand. `/queues?join=<queueId>` redirects to the same page.

A public **display board** is at `/kiosk/:queueId` (also linked as “Display board” on the admin console). Open it on a TV or tablet at the counter and use the browser’s full-screen control (or F11). The board shows honest now-serving / last-served token numbers per counter and a waiting count. It polls every few seconds. It is public and shows token numbers only — no student names or emails. There is no PIN gate in this release.

`index.html` includes a description, forest `theme-color` (`#1b4332`), and a web app manifest so phones can Add to Home Screen.

A small production service worker (`client/public/sw.js`, registered only in the production build) caches the app shell and the last successful catalog, status, and active-membership responses with a **network-first** policy. While you are online, live polling and Socket.IO behave as before — the worker only falls back when a fetch fails. Offline, the last-known place in line may appear with an “offline” note; it is stale until the network returns. Mutations (join, leave, login, admin actions) and Socket.IO are never cached. Logging out or logging in clears the status cache so a later session on the same device does not see the previous one. The worker does not implement Web Push (see Notifications above). Vite dev does not register the worker, so local HMR and polling are never intercepted.

True push-when-the-app-is-closed needs [Web Push](https://developer.mozilla.org/en-US/docs/Web/API/Push_API) (VAPID keys, a service worker `push` handler, and a server that holds subscription endpoints). That is a follow-up: the operator would generate a VAPID key pair, set something like `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` on a **long-running** API host (Vercel serverless is a poor fit for push fan-out), expose the public key to the client, and never commit the private key. Do not put real VAPID secrets in the repo.


## How to run the API as a long-running process for Instant updates

The live production API at `queueit-api.vercel.app` is a Vercel **serverless** function (`server/api/index.js`). That path is fine for HTTP (join, status, admin, polling). It cannot hold WebSocket connections, so the production app stays on “Updates every few seconds,” and the 15-second session closer in `server/src/index.js` does not run there (lazy close still happens on the next request).

Instant updates (`Socket.IO`) and punctual auto-close need a **long-running Node process** that starts `server/src/index.js` (`npm start` in `server/`, or `npm run dev:server` locally). This is already how local development works.

This section is a plan, not a production cutover. Do not move DNS, buy a paid plan, or copy production secrets in a drive-by change. The serverless entry should stay deployed and working with polling until an operator chooses to switch `VITE_API_URL` or DNS.

### What will not work on Vercel serverless

- **Socket.IO** (“Instant updates”). Instant updates need a long-running API process.
- The 15-second `SESSION_CLOSE_INTERVAL_MS` closer (override; minimum 1000). The session closer does not run on serverless; without it, sessions still close lazily on the next HTTP request.
- Web Push fan-out (see Notifications) is also a poor fit for serverless.

Polling (3 seconds when the tab is visible and no socket is connected, 15 seconds when Socket.IO is connected, paused when the tab is hidden) remains the fallback everywhere and is enough for the product to work. **Guests poll until guest socket auth exists**, including on a long-running host (see below).

### Guest Socket.IO auth (follow-up, not implemented)

Today the Socket.IO handshake accepts only `auth.token` (a user or admin JWT). Guests have no JWT, so they never join a socket room and stay on the 3-second poll, even when the API is a long-running process.

A later, safe design could issue a **device credential** when someone continues as a guest or joins a line: a random, hashed, membership-scoped secret stored with that guest record and presented in the handshake as something like `auth.guestToken`. The server would verify the hash, bind the socket only to that guest's queue rooms, and invalidate the credential when the membership ends or the guest upgrades to a signed-in account. Do not return the raw credential in list or status API responses, and do not log it. This is a design note only — no incomplete runtime is included here. Until that ships, guests poll.

### Recommended hosts

Any host that can run a persistent Node process and reach MongoDB Atlas is enough, for example:

- A VPS (a campus VM, Hostinger, or similar)
- [Render](https://render.com) Web Service (not a serverless function)
- [Fly.io](https://fly.io)

Point the process at `npm start` with the working directory `server/`. Put a TLS reverse proxy in front if the host does not terminate HTTPS for you.

### Environment

Set the same API variables as production, on the long-running host only (**never commit them**):

- `MONGODB_URI` — Atlas (or other Mongo) connection string
- `JWT_SECRET` — existing production secret; do not rotate casually
- `CLIENT_ORIGIN` — exact frontend origin (`https://queueit-seven.vercel.app`, or a new origin), comma-separated if you need more than one during a cutover
- `ARRIVAL_PASS_SECRET` — optional; falls back to `JWT_SECRET`
- `SEED_*` / `SEED_ON_BOOT` — only if you intend to upsert demo accounts
- `PORT` / `HOST` — as required by the host (`HOST=0.0.0.0` is typical behind a proxy)
- Optional: `SESSION_CLOSE_INTERVAL_MS`, `JWT_EXPIRES_IN`

The frontend needs `VITE_API_URL` at **build** time pointing at the long-running API origin (no trailing slash). After a cutover, set API `CLIENT_ORIGIN` to the frontend origin and rebuild the client.

### Operator cutover (not done in this repo change)

When you are ready: provision the host, set env vars on that host, confirm `GET /api/health`, confirm a logged-in user sees Instant updates, then change `VITE_API_URL` (and DNS if you use a custom API domain) and redeploy the client. Leave the Vercel API up until that is verified. Paid plans, DNS, and production secrets stay with the operator.

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

Socket.IO needs a long-running Node process (local, or a persistent host). It does not work on the Vercel serverless API. See [How to run the API as a long-running process for Instant updates](#how-to-run-the-api-as-a-long-running-process-for-instant-updates) for the hosting plan (this is not a production cutover).

On that same long-running process, a 15-second session closer closes queues whose `sessionEndsAt` has passed even when no one is calling the API. HTTP paths still run the lazy close on the next request (so a join cannot sneak in after the window). The Vercel serverless API does not run this interval — punctual close there would need an external cron; until then, close still happens on the next request. You can override the interval with `SESSION_CLOSE_INTERVAL_MS` (minimum 1000).

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
| `npm test` | Server HTTP API tests + client unit tests |
| `npm run lint` | ESLint for client and server |
| `npm run test:e2e` | Playwright smoke (login + queues list) |
