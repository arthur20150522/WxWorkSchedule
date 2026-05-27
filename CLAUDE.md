# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WxSchedule is a WeChat Robot Scheduled Task Management System — a full-stack app combining a wx4py-based WeChat bot (Windows UI Automation) with a React web dashboard. It supports multi-user WeChat automation with scheduled/recurring messaging to groups and contacts.

## Development Commands

**Backend (`server/` directory):**
```bash
npm run dev      # TypeScript watch mode (tsx)
npm run build    # Compile TypeScript to dist/
npm run start    # Run compiled production build
```

**Frontend (`client/` directory):**
```bash
npm run dev      # Vite dev server on http://localhost:5173
npm run build    # Type check + Vite production build
npm run preview  # Preview production build
```

**Local development setup (two terminals):**
```bash
# Terminal 1
cd server && npm run dev   # API on http://localhost:3000

# Terminal 2
cd client && npm run dev   # UI on http://localhost:5173 (proxies /api to :3000)
```

There are no automated tests. Manual testing requires a real or mock WeChat session.

## Architecture

### Multi-Tenant Model
Each user gets a separate lowdb JSON database at `server/users/<username>/db.json`. The bot runs as a single wx4py instance (Windows UIA) — WeChat must be pre-logged-in on the Windows desktop. All users share the same bot for message delivery.

### Task Execution Pipeline
1. **Scheduler** (`scheduler.ts`) — polls every 10 seconds; queries all users' DBs for tasks where `scheduleTime <= now` and status is `pending`
2. **TaskQueue** (`taskQueue.ts`) — singleton per user; deduplicates tasks; executes sequentially with 500ms delays; sends messages via Wechaty
3. **Recurrence** — after execution, calculates next run time using date-fns and resets task to `pending`
4. **wx4py Bridge** (`wxBridge.ts` + `pybridge/bridge.py`) — Node.js HTTP client talks to a Python HTTP server on `127.0.0.1:39800` that wraps wx4py for WeChat Windows UI Automation

### Authentication
JWT tokens (7-day expiry) issued on POST `/api/login`, verified by `authMiddleware.ts` on all protected routes. Passwords stored as bcrypt hashes in `server/.user` (JSON file); plain-text passwords are migrated on first login.

### Data Model
Tasks support cyclic content: `content: string[]` with `currentContentIndex` tracking which message to send next, rotating on each execution. Recurrence types: `once | daily | weekly | monthly | interval` (interval uses `intervalValue` + `intervalUnit`).

Database schema (lowdb JSON): `{ tasks: Task[], templates: Template[], logs: Log[] }`. `dbManager.ts` handles migrations (e.g., converting legacy string content to string arrays).

### Frontend Structure
- `App.tsx` — main state, API polling, tab-based routing
- `views/` — one view per tab (Dashboard, Groups, Tasks, Templates, Logs)
- `utils/i18n.ts` — UI strings (Chinese primary)
- Vite proxies `/api/*` → `http://localhost:3000` in dev

## Configuration

**`server/.env`** (required):
```
PORT=3000
JWT_SECRET=<your-secret>
```

**`server/.user`** (auto-created, JSON):
```json
{ "admin": "bcrypt_hash_or_plaintext" }
```

Both files are `.gitignored`. The `server/users/` directory (user data) is also `.gitignored`.

## Deployment

Use `deploy.ps1` (Windows) or `deploy.sh` (Unix) to build, SCP to remote server, and restart via PM2. Nginx examples are in `nginx.conf.example` and `wxwork_nginx.conf` — static files served directly, `/api/*` proxied to Express.
