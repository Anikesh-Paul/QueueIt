# QueueIt (QIT)

Virtual queue management system for Summer School ’26 MERN evaluation.

**Stack:** MongoDB · Express · React · Node · JWT (product features land in later tickets)

This monorepo is the Phase 0 scaffold: empty client shell + Express health check + env templates. No auth, queues, or deploy yet.

## Layout

```
.
├── client/          # React (Vite) frontend
├── server/          # Express API
├── package.json     # npm workspaces root
└── README.md
```

## Prerequisites

- Node.js 20+
- npm 10+

## Setup

```bash
# Install all workspace dependencies
npm install

# Optional: copy env templates (no secrets in the repo)
copy server\.env.example server\.env
copy client\.env.example client\.env
```

On macOS/Linux use `cp` instead of `copy`.

## Run locally

Two terminals:

```bash
# API — http://localhost:5000
npm run dev:server

# Client — http://localhost:5173
npm run dev:client
```

Health check:

```bash
curl http://localhost:5000/api/health
# → {"status":"ok","service":"queueit-server"}
```

## Tests

```bash
npm test
# currently: server health endpoint (node:test + supertest)
```

## Environment

| File | Purpose |
|------|---------|
| `server/.env.example` | `PORT`, `CLIENT_ORIGIN`, placeholders for Mongo/JWT |
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
| `npm test` | Server tests |

## Out of scope (this scaffold)

Auth, roles, venue seed, join/leave/serve/skip/pause, deploy hosts, Playwright E2E, and stretch features land in later work — not in this scaffold.
