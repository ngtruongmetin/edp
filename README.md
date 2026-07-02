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

Run:

```bash
docker compose up --build
```

Frontend is exposed on `http://127.0.0.1:${FRONTEND_PORT}` and backend remains on `http://127.0.0.1:${PORT}`.

## Deployment notes

- Set PostgreSQL credentials via `.env` or `DATABASE_URL`
- Ensure the target database exists and is reachable from the backend container/process
- The backend schema is initialized automatically from `backend/sql/schema.postgresql.sql`
- To switch PostgreSQL instances, only update `.env`

## Database layer

- Shared pool module: `backend/config/database.js`
- Compatibility adapter: `backend/db.js`
- PostgreSQL schema: `backend/sql/schema.postgresql.sql`
- Promise helpers and DB error mapping: `backend/utils/dbp.js`
