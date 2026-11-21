<div align="center">

# QueueIt

**Hold your place. Not the line.**

Virtual queues for campus services. Students scan a poster or open the app, take a token, and wait wherever they like. QueueIt tells them when to walk over. Staff run the counter from a console with multiple desks, signed arrival passes, shifts, notices and analytics, all in campus time (IST).

[**Live app**](https://queueit-seven.vercel.app) · [Public wait board](https://queueit-seven.vercel.app/status-board) · [API health](https://queueit-api.vercel.app/api/health)

English · हिन्दी · বাংলা  ·  Light and dark  ·  Installable PWA  ·  WCAG AA tested

![QueueIt landing page: “Hold your place. Not the line.” with a phone showing token A27](docs/screenshots/landing-desktop.webp)

</div>

---

## Contents

- [What it does](#what-it-does)
- [Tour](#tour)
  - [Students](#students)
  - [Public screens](#public-screens)
  - [Staff and admins](#staff-and-admins)
- [Features](#features)
- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Security](#security)
- [Testing](#testing)
- [Deployment](#deployment)
- [Known limits](#known-limits)
- [Project docs](#project-docs)

## What it does

| For | QueueIt gives you |
|-----|-------------------|
| **Students and visitors** | A token from a poster QR or the app, with no account needed. Live position, a wait *range* rather than a guess, a nudge when it's time to leave, and a called banner with a countdown. Group tickets, booked slots, priority requests, history and ratings. |
| **Counter staff** | Call, serve, skip, pause, walk-ins and arrival-pass scans for several counters. Shifts and breaks feed the wait estimates, and handover notes carry over to the next shift. |
| **Admins** | Venues and queues across several organizations, configurable queue rules, a notice board, analytics with CSV export, a full audit log, a live TV dashboard, and scoped access for staff and org admins. |
| **Anyone** | A public wait board and a kiosk display for every line. No login needed. |

## Tour

Screenshots come from a local build with demo data.

### Students

<table>
<tr>
<td width="50%"><img src="docs/screenshots/login-desktop.webp" alt="Sign-in card over a campus scene, with live waits and Continue as Guest"><br><sub><b>Sign in</b>, or continue as a guest. Live waits are shown behind the form.</sub></td>
<td width="50%"><img src="docs/screenshots/catalog-desktop.webp" alt="Queues list with a rating prompt, a campus notice, and wait ranges for Cafeteria and Gym"><br><sub><b>Queues</b> with wait ranges, now-serving numbers, starred lines, notices and a rating prompt after a visit.</sub></td>
</tr>
<tr>
<td><img src="docs/screenshots/join-desktop.webp" alt="Join page with a party-size picker and a Best time to come chart by weekday"><br><sub><b>Join</b> with a party of 1–4. <b>Best time to come</b> charts crowd and typical wait by hour for each weekday.</sub></td>
<td><img src="docs/screenshots/status-called-desktop.webp" alt="Status page while being called at Counter 1, with an I'm here button and a signed arrival-pass QR"><br><sub><b>Called</b>: a no-show countdown, an <i>I'm here</i> button, and a signed arrival-pass QR for the desk.</sub></td>
</tr>
<tr>
<td colspan="2"><img src="docs/screenshots/visits-desktop.webp" alt="My visits page with totals, average wait, most-used queues, filters and past tickets"><br><sub><b>My visits</b>: every ticket with its wait and outcome, summary stats, filters, and <i>Rate this visit</i>.</sub></td>
</tr>
</table>

On a phone: waiting with a *Time to head over* alert, being called, and joining from a poster QR as a guest.

<p align="center">
<img src="docs/screenshots/status-waiting-mobile.webp" width="250" alt="Mobile status: position 3, ETA range and a Time to head over card">
&nbsp;
<img src="docs/screenshots/status-called-mobile.webp" width="250" alt="Mobile status while being called to a counter">
&nbsp;
<img src="docs/screenshots/join-guest-mobile.webp" width="250" alt="Guest join after scanning a poster QR, with a party-size picker">
</p>

The same app in Bengali, in dark mode, and in Hindi:

<p align="center">
<img src="docs/screenshots/catalog-bengali-mobile.webp" width="250" alt="Queues page in Bengali">
&nbsp;
<img src="docs/screenshots/catalog-dark-mobile.webp" width="250" alt="Queues page in dark mode">
&nbsp;
<img src="docs/screenshots/status-hindi-mobile.webp" width="250" alt="Status page in Hindi">
</p>

### Public screens

<table>
<tr>
<td width="50%"><img src="docs/screenshots/status-board-desktop.webp" alt="Campus wait times board with Cafeteria and Gym wait ranges"><br><sub><b>/status-board</b>: every line's wait without signing in. Share it in a group chat or show it on a lobby screen.</sub></td>
<td width="50%"><img src="docs/screenshots/kiosk-desktop.webp" alt="Kiosk board: Cafeteria now serving 1 with a Scan to join QR"><br><sub><b>/kiosk/:queueId</b>: a now-serving board for a TV or tablet, with notices and a <i>Scan to join</i> QR.</sub></td>
</tr>
</table>

### Staff and admins

<table>
<tr>
<td colspan="2"><img src="docs/screenshots/admin-console-desktop.webp" alt="Admin console for Cafeteria: now serving, waiting count, call/serve/skip/pause, arrival check and walk-in form"><br><sub><b>Queue console</b>: call, serve, skip, pause, stop accepting tokens, extend the session, check arrivals and add walk-ins.</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/live-view-desktop.webp" alt="Live view dashboard with served today, average wait, waiting now, no-shows, open counters and per-queue cards"><br><sub><b>Live view</b>: today's numbers on a TV, with TV mode, high contrast and queue rotation.</sub></td>
<td width="50%"><img src="docs/screenshots/shift-desktop.webp" alt="Your shift page listing counters with Start shift here and Close counter"><br><sub><b>Shift</b>: start, break, return and end. Calls only go to open counters.</sub></td>
</tr>
<tr>
<td><img src="docs/screenshots/campus-analytics-desktop.webp" alt="Campus analytics: served, average wait, no-show rate, peak hour, served per day and peak hours charts"><br><sub><b>Campus analytics</b>: served per day, peak hours, average and 90th-percentile wait, no-show rate, ratings, CSV export.</sub></td>
<td><img src="docs/screenshots/queue-analytics-desktop.webp" alt="Queue analytics with busiest hours and a 7×24 usual-busyness heatmap"><br><sub><b>Queue analytics</b> with a 7×24 IST busyness heatmap and a quiet-hour hint.</sub></td>
</tr>
<tr>
<td><img src="docs/screenshots/notices-desktop.webp" alt="Announcement board form with scope, tone, title and time window, plus a live notice"><br><sub><b>Notices</b> for the whole campus, one venue or one line, with Info, Delay or Closure tone.</sub></td>
<td><img src="docs/screenshots/audit-desktop.webp" alt="Audit log filtered by kind, person, queue and date"><br><sub><b>Audit log</b>: who did what and when, filterable, with CSV export.</sub></td>
</tr>
<tr>
<td colspan="2"><img src="docs/screenshots/admin-catalog-desktop.webp" alt="Catalog editor with organizations, venues and queues, each with a Rules and options panel"><br><sub><b>Catalog</b>: organizations, venues and queues, each with its own rules for no-shows, rejoin, priority, guests, groups and bookings.</sub></td>
</tr>
</table>

## Features

<details open>
<summary><b>Joining and waiting</b></summary>

- **Three ways in.** Browse the queue list, open a poster link (`/join/:queueId`) from a printed QR, or continue as a guest. Guests who register or log in later keep their place and their history.
- **Group tickets.** One ticket covers 1–4 people. Admins set the maximum per queue or turn groups off. Each extra person counts as a fraction of a serve in estimates (default 0.5). A waiting student can make their party smaller.
- **Appointment slots** alongside walk-ins. Admins turn on bookings per queue and set slot length, people per slot and a grace period. Students book a slot and check in from 15 minutes before it. Once a slot starts, booked arrivals and walk-ins are served one for one. Two missed bookings in 14 days pause booking for a week.
- **Honest waits.** The estimate blends today's pace with the same hour in past weeks and is shown as a range ("Wait about 21–33 min"). It follows how many counters are actually open, so a staff break lengthens it.
- **Best time to come.** An hourly crowd and typical-wait chart for each weekday, built from the last 8 weeks in campus IST, plus "Best time left today" and "Usually quiet around X" hints. It only names an hour when the data supports it.
- **Smart routing.** Admins can group same-venue queues as *equivalent*, and students then see "A shorter line is open at …". Nobody is moved automatically.
- **Leave-when-it's-time.** Each place carries a travel time (default 10 min). The status page shows when to set off, based on the live serving pace, and can raise a notification.
- **Called flow.** Students get a near-front prompt when they're in the top 3. When called, they see which counter, a countdown and an **I'm here** button, which stops the no-show timer.
- **Signed arrival pass.** A QR (`QIT:<queue>:<token>:<mac>`, HMAC-SHA256) for staff to scan. It shows that the token is waiting, not who the person is.
- **After the visit.** A 1–5 rating with an optional comment, once per ticket and within 7 days. **My visits** lists every ticket with its wait and outcome, plus summary stats and filters kept in the URL. Starred queues are pinned to the top of the list.
- **Notices** from staff appear on the queue list, the status page and the kiosk. Students can dismiss ones they've read.

</details>

<details>
<summary><b>Queue rules (set per queue in the catalog)</b></summary>

- **No-show window.** Calling someone starts a deadline (default 5 min, range 1–30). In *Fixed* mode it is always that long. In *Dynamic* mode it scales with recent arrival times, line length and counter pace, within admin min/max. As an option, the next person can be called automatically when the window runs out.
- **Missed-turn recovery.** A student skipped as a no-show can rejoin **once** within a window (default 15 min). They go back in N places behind the current serving point (default 2) without pushing anyone back.
- **No-show tracking.** Students see why they were skipped. Anyone with 3 or more no-shows in 30 days gets a *Frequent no-show* tag for staff and appears in an analytics table.
- **Priority lanes.** Staff can mark priority (accessibility, pregnancy, medical, other), and students can request it for staff approval. At most every *K*th serve is a priority one (default 3), so the regular line keeps moving.
- **Capacity and guests.** A *max waiting* cap (the queue shows *Full*, and joins return 409), a guest-join toggle, and guest limits: 2 places per guest pass, a pause after repeated no-shows, and a cap per network.
- **Service windows** in IST: day-of-week scope, overnight windows (e.g. 22:00–02:00), and holiday and exception dates. Staff can start or stop accepting tokens, extend a session or reset the line.

</details>

<details>
<summary><b>Running the counter</b></summary>

- **Console:** waiting list with call, serve, skip, pause and resume. *Call next* goes to the open counter that has been idle longest, or to a counter staff pick.
- **Walk-ins** for people without the app, including groups.
- **Check arrival** by camera scan or by pasting a signed pass. Unsigned passes are rejected unless `ALLOW_UNSIGNED_ARRIVAL=1`.
- **Shifts.** Start at a counter, take a break, come back, end the shift. Counters open and close to match, and nobody can be called to a counter that's on break.
- **Handover notes** at a counter or queue (500 characters, plain text). Ending a shift asks for a note, and starting one shows unread notes to acknowledge. Notes can be pinned or marked important or resolved, and they expire automatically (default 24 h, up to 7 days).
- **Printable A4 poster** at `/admin/queues/:queueId/poster` with the join QR (this is not an arrival pass).

</details>

<details>
<summary><b>Administration and insight</b></summary>

- **Organizations.** Organizations own venues, so one deployment can serve a main campus and, say, a hospital annex. When there is more than one, students pick theirs, and `?org=<slug>` links straight to it.
- **Scoped access.** *Global admins* manage everything. *Org admins* manage only their organizations. *Staff* are tied to a venue and can be limited to certain queues. The server enforces this on every admin route and socket room. Invite staff from the Catalog and manage admins under **Access**.
- **Catalog editor.** Add, rename or archive organizations, venues and queues without re-seeding, and set every rule above.
- **Announcement board.** Post to the campus, a venue or a queue in Info, Delay or Closure tone, with start and end times (up to 7 days). Notices can be edited or ended early.
- **Analytics** (`/admin/analytics`): Today, 7 days, 30 days or a custom range (up to 92 days). Shows served per day, peak hours, average and p90 wait, no-show rate, people as well as tickets, and ratings per queue and per counter with recent comments. CSV export contains no names or emails. Each queue's page adds a 7×24 busyness heatmap.
- **Live view** (`/admin/live`): a full-screen dashboard of today's numbers that refreshes itself, with TV mode, high contrast and queue rotation (`?rotate=10`).
- **Audit log** (`/admin/audit`): queue actions, rule changes, notices, notes, shifts, priority decisions, access changes and sign-in security events. Filter by kind, person, queue and date, export as CSV. Entries are kept for 90 days.

</details>

<details>
<summary><b>Everywhere</b></summary>

- **Languages.** English, Hindi and Bengali on every student, public and sign-in screen, with Indian number and date formatting (lakh grouping) and self-hosted Noto fonts. The choice is remembered per device and defaults to the browser language. Admin work screens are English only.
- **Light and dark theme**, following the device until you pick one.
- **Accessibility.** Skip links, keyboard paths, reduced-motion support, and Playwright + axe WCAG AA scans in both themes.
- **Installable and offline-friendly.** A web manifest and a service worker that caches the app shell and the last known queue list and status. Offline, your ticket and an "as of" time stay on screen, and the page syncs again when you reconnect. A *New version available* prompt switches builds safely. Sign-in and staff responses are never cached.
- **Live updates.** Socket.IO on a long-running API. Otherwise polling every 3 s while the tab is visible, slowing to 15 s when a socket is connected.
- **Browser notifications** while the tab is open: top 3, next, now serving, time to leave, and *notify me when this queue opens*.

</details>

## How it works

```mermaid
flowchart LR
  subgraph Client["client/ — React 19 + Vite PWA"]
    S[Student and guest pages]
    P[Public: landing, status board, kiosk]
    A[Staff and admin console]
  end
  subgraph Server["server/ — Express API"]
    R[REST routes<br/>auth · queues · me · admin · status-board]
    SV[Services<br/>estimates · no-shows · priority · shifts · notices · audit]
    IO[Socket.IO<br/>long-running host only]
  end
  DB[(MongoDB)]
  S & P & A -- HTTPS + polling --> R
  S & A -. websocket .-> IO
  R --> SV --> DB
```

| Layer | Stack |
|-------|-------|
| Client | React 19, React Router 7, Vite 8, Tailwind CSS 4, shadcn/ui, service worker (PWA) |
| Server | Node 20+, Express 4, Mongoose 9, Socket.IO 4, JWT sessions, Helmet, express-rate-limit |
| Data | MongoDB (local `mongod` or Atlas) |
| Tests | `node:test` + `mongodb-memory-server`, client unit tests, Playwright + `@axe-core/playwright` |
| Hosting | Vercel (client and a serverless API), with an optional long-running API for realtime |

```
.
├── client/            React app (pages, components, locales en/hi/bn, service worker)
├── server/            Express API (routes, models, services, seed scripts, tests)
├── e2e/               Playwright: smoke/, flows/, tickets/<NN>-<slug>/
├── docs/              ADRs, agent docs, README screenshots
├── CONTEXT.md         Domain glossary
├── DESIGN.md          Visual system (palette, type, radius, elevation)
└── PRODUCT.md         Product brief
```

<details>
<summary><b>Routes</b></summary>

| Path | Who | Page |
|------|-----|------|
| `/` | signed out | Landing page |
| `/login`, `/register`, `/forgot-password`, `/reset-password` | signed out | Auth |
| `/status-board` | anyone | Public wait board (`?org=`, `?venue=`) |
| `/kiosk/:queueId` | anyone | Now-serving display with a join QR |
| `/join/:queueId` | anyone (guest or user) | Join one queue (poster link) |
| `/queues` | user / guest | Queue list |
| `/status` | user / guest | Your place in line |
| `/visits` (`/history`) | user / guest | My visits |
| `/book/:queueId` | user | Book an appointment slot |
| `/security` | signed in | Two-step sign-in, sign out of all devices |
| `/admin/queues/:queueId` | staff / admin | Queue console |
| `/admin/queues/:queueId/analytics` | staff / admin | Queue analytics |
| `/admin/queues/:queueId/poster` | staff / admin | Printable A4 poster |
| `/admin/catalog` | admin | Organizations, venues, queues, staff invites |
| `/admin/analytics` | staff / admin | Analytics report + CSV |
| `/admin/live` | staff / admin | Live TV dashboard |
| `/admin/shift` | staff / admin | Your shift and the counter board |
| `/admin/notices` | staff / admin | Announcement board |
| `/admin/audit` | staff / admin | Audit log + CSV |
| `/admin/access` | global admin | Org admins and staff assignments |

</details>

## Quick start

You need Node.js 20+, npm 10+, and MongoDB (local `mongod`, Docker or Atlas).

```bash
npm install

# macOS / Linux
cp server/.env.example server/.env
cp client/.env.example client/.env
# Windows (PowerShell)
Copy-Item server/.env.example server/.env
Copy-Item client/.env.example client/.env
```

In `server/.env`, set `MONGODB_URI`, a strong `JWT_SECRET`, and the `SEED_ADMIN_*` / `SEED_USER_*` demo accounts. These are for local use only; never commit them.

```bash
npm run seed         # demo accounts + Campus Hub (Cafeteria ~3 min/serve, Gym ~5 min/serve)
npm run dev:server   # API    → http://localhost:5000
npm run dev:client   # Client → http://localhost:5173
```

Health check: `GET /api/health` returns `{"status":"ok","service":"queueit-server"}`.

The seed can be run again safely. It updates the demo passwords but leaves catalog edits, windows, pause state and token counters alone. To restore the default windows and `open` status on purpose, run it with `SEED_RESET_CATALOG=true`. Anyone can register, and new accounts are always students.

### Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev:server` / `dev:client` | API with file watch / Vite dev server |
| `npm run start:server` | API in production mode |
| `npm run build:client` | Production client build |
| `npm run seed` | Upsert demo accounts and the starter catalog |
| `npm run seed:e2e` | Wipe and seed the dedicated `queueit-e2e` database |
| `npm test` | Server HTTP API tests + client unit tests |
| `npm run lint` | ESLint 9 over client and server |
| `npm run test:e2e` | Playwright: smoke, flows and ticket specs |
| `npm run test:e2e:smoke` / `test:e2e:flows` | Only smoke / only flows |

## Configuration

Copy the `.env.example` files to `.env`. **Never commit `.env` or real secrets.**

<details>
<summary><b>Server variables</b> (<code>server/.env</code>)</summary>

| Variable | Purpose |
|----------|---------|
| `PORT`, `HOST`, `NODE_ENV` | API port (default `5000`), bind address (`0.0.0.0` on cloud hosts), environment |
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | **Required.** Strong random signing secret |
| `JWT_EXPIRES_IN` | Token lifetime (default `7d`) |
| `CLIENT_ORIGIN` | Exact frontend origin(s), comma-separated |
| `ARRIVAL_PASS_SECRET` | HMAC key for arrival passes (falls back to `JWT_SECRET`) |
| `ALLOW_UNSIGNED_ARRIVAL` | `1` to accept legacy unsigned passes and typed token numbers. Default off |
| `TOTP_ENCRYPTION_KEY` | Encrypts two-step secrets at rest (derived from `JWT_SECRET` if unset). If it changes, enrolled admins need a backup code |
| `SEED_ON_BOOT` | `true` to seed on process start (first deploy only) |
| `SEED_RESET_CATALOG` | `true` only to restore default windows and status while seeding |
| `SEED_ADMIN_EMAIL` / `_PASSWORD` / `_NAME` | Demo admin |
| `SEED_USER_EMAIL` / `_PASSWORD` / `_NAME` | Demo student |
| `SESSION_CLOSE_INTERVAL_MS` | Long-running host only: how often expired sessions close (default `15000`) |
| `PASSWORD_RESET_EXPIRES_MINUTES` | Reset link lifetime (default `60`) |
| `GUEST_MINTS_PER_HOUR` | New guest passes per network per hour (default `60`) |
| `TRUST_PROXY` | `1` / `0` to force Express `trust proxy` (on by default under Vercel) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Optional mail transport. When unset, reset links go to the server log |

</details>

<details>
<summary><b>Client variables</b> (<code>client/.env</code>)</summary>

| Variable | Purpose |
|----------|---------|
| `VITE_API_URL` | API base URL at **build** time, with no trailing slash. Local default: `http://localhost:5000` |

CORS rejects browser calls unless `CLIENT_ORIGIN` matches the site origin exactly (scheme, host and port).

</details>

## Security

- **Two-step sign-in** (TOTP) for admins and staff, opt-in under *Account security*: 10 one-time backup codes, seeds encrypted with AES-256-GCM, backup codes stored only as hashes. A password reset never skips the code step.
- **Sign out of all devices.** A version on each session token revokes every older token, for REST and Socket.IO alike. A password reset does the same.
- **Lockout.** Failed sign-ins are counted per account and per IP in MongoDB, so the count holds across serverless instances: 5 failures in 15 min lock the account and 30 lock the IP. Unknown emails get the same response and the same bcrypt cost, so nobody can tell which accounts exist.
- **Password reset.** Tokens are 256-bit, stored as SHA-256 hashes, single use, and expire. The "forgot password" response is the same whether or not the email exists.
- **Guest credentials** are high-entropy and returned once. Only a hash is stored.
- **Headers.** The API uses Helmet with a deny-all CSP and `no-store` on auth and admin routes. The web app (`client/vercel.json`) has a strict CSP, `X-Frame-Options: DENY`, and a Permissions-Policy that allows only the camera, for QR scanning.
- **Limits.** JSON bodies are capped at 16 kb. Auth and join endpoints are rate-limited per IP, and inputs are validated (passwords 8–128 characters, names up to 80).
- **Scope is enforced on the server** for every admin route and socket room, not only hidden in the UI.

Sessions are kept in `localStorage`. That is convenient, but any XSS could read them; moving to httpOnly cookies would be a separate migration.

## Testing

```bash
npm test               # server API (in-memory MongoDB) + client unit tests
npm run lint
npm run test:e2e       # needs local MongoDB; wipe-seeds only queueit-e2e
```

Playwright starts the API on `:5000` and Vite on `:5173` against the dedicated `queueit-e2e` database, never the developer `queueit` one. The suites cover student join and leave, guest QR join, admin call and serve, no-shows, group tickets, feedback, shifts, notices, handover notes, organizations and org admins, analytics and CSV, the live view, My visits, i18n, offline, security/TOTP, dark mode, keyboard paths, and axe WCAG AA scans in both themes. Reports go to `playwright-report/index.html`, and traces from failures go to `test-results/`; both are gitignored.

Runtime changes are closed through a Playwright gate. See [AGENTS.md](AGENTS.md) and [docs/agents/playwright-gate.md](docs/agents/playwright-gate.md).

## Deployment

Production runs on free tiers: **MongoDB Atlas**, an API on **Vercel** from `server/`, and the client on **Vercel** from `client/`.

| Surface | URL |
|---------|-----|
| Frontend | https://queueit-seven.vercel.app |
| Backend API | https://queueit-api.vercel.app |
| Health | https://queueit-api.vercel.app/api/health |

1. **Atlas.** Create a cluster and a database user, allow the API host, and set `MONGODB_URI` on the API project only.
2. **API.** Run `cd server && vercel --prod`. Set `MONGODB_URI`, `JWT_SECRET` and `CLIENT_ORIGIN`. For the first seed, also set `SEED_ON_BOOT=true` with the `SEED_*` accounts, then turn it back to `false`.
3. **Client.** Run `cd client && vercel --prod` with `VITE_API_URL=https://<api-host>` set at build time. If CORS fails, update the API's `CLIENT_ORIGIN` and redeploy.
4. **Smoke test.** Log in as the student and join a queue. In another browser, log in as the admin and serve. The student view should update within a few seconds.

<details>
<summary><b>Serverless vs a long-running API</b></summary>

The Vercel API is a serverless function (`server/api/index.js`). It handles all HTTP traffic, so join, status, admin and polling all work there. It cannot hold WebSockets, though, so production uses 3-second polling, and expired sessions close on the next request instead of on a 15-second timer.

**Instant updates** (Socket.IO) and on-time auto-close need a persistent Node process running `server/src/index.js` (`npm start` in `server/`). Local development already works this way. Any VM, VPS, Render web service or Fly.io app that can reach MongoDB will do. Put TLS in front of it, set the same env vars, and build the client with `VITE_API_URL` pointing at it. Keep the Vercel API running until the switch is verified.

</details>

## Known limits

- Instant updates and on-time session close need a long-running API host. The production Vercel API polls.
- Guests always poll, because the Socket.IO handshake accepts JWTs only.
- Notifications only work while the QueueIt tab is open. True push (Web Push/VAPID) is not implemented.
- The arrival pass is a counter convenience, not proof of identity. The kiosk and status board are public and show token numbers only.
- Admin work screens are English only.
- `npm audit --omit=dev` is clean. The remaining findings are in dev and CLI dependencies.

## Project docs

- [CONTEXT.md](CONTEXT.md): domain language (queue, token, counter, session, no-show…)
- [PRODUCT.md](PRODUCT.md): product brief and audience
- [DESIGN.md](DESIGN.md): visual tokens and components
- [docs/adr/](docs/adr): architecture decisions
- [docs/agents/](docs/agents): issue tracker, triage labels, Playwright gate
