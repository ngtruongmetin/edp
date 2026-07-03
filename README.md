# EDP PostgreSQL Setup

This project now runs on PostgreSQL through the `pg` package only. Business logic, routes, API payloads, controllers, middleware, permissions, scoring, reports, uploads, and frontend behavior stay unchanged.

## Environment

Copy `.env.example` to `.env` and configure:

```env
PORT=3000
FRONTEND_PORT=5173
BACKEND_ORIGIN=http://127.0.0.1:3000
SESSION_SECRET=your-session-secret

DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=edp
DB_USER=postgres
DB_PASSWORD=postgres
DATABASE_URL=
DB_TIMEZONE=Asia/Ho_Chi_Minh
```

`DATABASE_URL` is optional. If provided, backend uses it instead of the individual `DB_*` variables.
`DB_TIMEZONE` defaults PostgreSQL sessions to GMT+7 (`Asia/Ho_Chi_Minh`).

## Local backend

```bash
cd backend
npm install
npm start
```

## Local frontend

```bash
cd frontend
npm install
npm run dev
```

On startup the backend:

1. Creates a shared PostgreSQL `Pool`
2. Applies `backend/sql/schema.postgresql.sql`
3. Backfills compatibility columns if needed
4. Seeds `year_summaries` only when empty

## Docker

`docker-compose.yml` provides:

- `postgres`: PostgreSQL 16 with a persistent volume
- `backend`: Node backend that starts only after PostgreSQL passes `pg_isready`
- `frontend`: Vite app built to static files and served by Nginx, proxying `/api` and `/assets` to the backend

Run locally:

```bash
docker compose up -d --build
```

Local access:

- Frontend: `http://127.0.0.1:${FRONTEND_PORT}`
- Backend: `http://127.0.0.1:${PORT}`

## Production deploy

This repo is ready for a production-style deploy with:

- PostgreSQL in Docker
- Backend in Docker
- Frontend in Docker
- Host Nginx as the public entrypoint for the domain `ntbd.edp.io.vn`

Recommended flow:

1. Copy `.env.example` to `.env` and fill production values.
2. Set `DB_HOST=postgres` only when using the compose stack.
3. Point your public domain `ntbd.edp.io.vn` to the server IP.
4. Put the Nginx vhost file from `deploy/nginx/ntbd.edp.io.vn.conf` into `/etc/nginx/sites-available/`.
5. Enable it with a symlink to `/etc/nginx/sites-enabled/` and reload Nginx.
6. Start the stack with `docker compose up -d --build`.

The provided Nginx sample proxies the domain to the frontend container on `127.0.0.1:5173`, and the frontend container continues proxying `/api` and `/assets` to the backend.

If you want HTTPS, terminate TLS at host Nginx and keep the proxy target unchanged.

## Deployment notes

- Set PostgreSQL credentials via `.env` or `DATABASE_URL`
- Ensure the target database exists and is reachable from the backend container/process
- The backend schema is initialized automatically from `backend/sql/schema.postgresql.sql`
- To switch PostgreSQL instances, only update `.env`
- Keep `CLASS_DEFAULT_PASSWORD`, `CLASS_DEFAULT_PIN`, `SEED_DEFAULT_PASSWORD`, and `SEED_DEFAULT_PIN` in `.env` for seed/reset utilities during test deploys

## Database layer

- Shared pool module: `backend/config/database.js`
- Compatibility adapter: `backend/db.js`
- PostgreSQL schema: `backend/sql/schema.postgresql.sql`
- Promise helpers and DB error mapping: `backend/utils/dbp.js`
