# Kaneo v2

Two standalone projects that replace the monorepo's `apps/api` and `apps/web`
(and the bundled `Dockerfile.kaneo`, `compose.yml`, `charts/kaneo`, `deploy/`):

- `backend/`: NestJS 12 + TypeORM API on PostgreSQL. All configuration comes
  from environment variables. It runs its own migrations at startup, before it
  listens, and serves everything under `/api` plus the MCP OAuth discovery
  documents under `/.well-known/`.
- `frontend/`: React + Vite single-page app. Its only setting is the
  build-time `VITE_API_URL`; everything else it reads from `GET /api/config`.

Each project has its own `package.json`, `pnpm-lock.yaml` and
`pnpm-workspace.yaml`, so it installs and builds outside the monorepo
workspace. Redis is optional; a single backend instance needs only PostgreSQL.

## Local development

Requires Node 24.11+, pnpm 10 and a PostgreSQL 16 server.

```sh
# Backend: http://localhost:1338
cd v2/backend
cp .env.example .env        # set AUTH_SECRET (openssl rand -hex 32) and DATABASE_URL
pnpm install
pnpm dev                    # nest start --watch; migrations run on startup

# Frontend: http://localhost:5174
cd v2/frontend
cp .env.example .env        # contains only VITE_API_URL=http://localhost:1338
pnpm install
pnpm dev
```

The backend reads `v2/backend/.env` (dotenv, then the process environment
wins). The frontend `.env` holds nothing but `VITE_API_URL`; leave it empty to
call the API at the page's own origin. Outside production the backend accepts
`localhost` and `127.0.0.1` variants of `KANEO_CLIENT_URL` / `CORS_ORIGINS`.

**Database host:** point `DATABASE_URL` at `127.0.0.1`, not `localhost`. On
machines where something else holds IPv6 localhost (`[::1]:5432`), `localhost`
resolves there first and reaches the wrong server or hangs. The same applies
to the published web port in the Docker setup below: use
`http://127.0.0.1:8088` if `localhost` does not answer.

### Tests

```sh
cd v2/backend
pnpm test                   # unit tests (vitest)
pnpm test:integration       # API tests against PostgreSQL, files run serially
pnpm typecheck

cd v2/frontend
pnpm test
pnpm typecheck
pnpm lint
```

Integration tests use the server in `DATABASE_URL` but always switch to the
database named by `TEST_DATABASE_NAME` (default `kaneo_v2_test`). They truncate
every table, so the name must end in `_test` or the run refuses to start.
Create the database once (`createdb kaneo_v2_test`); the test app applies the
migrations. Give parallel runs (one per developer or agent) their own
`TEST_DATABASE_NAME`, e.g. `kaneo_v2_w1_test`.

### API contract

`backend/contract/openapi.json` is the published API description, and
`test/integration/openapi-contract.test.ts` fails when the generated
`GET /api/openapi` no longer matches it. When you change a route on purpose,
regenerate the file (start the backend with `KANEO_API_URL` unset and save
`/api/openapi`), copy it to `frontend/openapi/openapi.json` and run
`pnpm openapi:types` in `frontend` so the web app's types follow.

## Deploying with Docker

`compose.yml` is the recommended **same-origin** layout: the web app and the
API share one public origin. The frontend's nginx serves the SPA and proxies
`/api/` (including the `/api/ws/...` WebSocket upgrades) and `/.well-known/`
to the backend. Only the frontend port is published; Postgres and the backend
stay on the internal network.

```sh
cd v2
cp .env.example .env        # at least AUTH_SECRET and POSTGRES_PASSWORD
docker compose up -d --build
# http://localhost:8088 (KANEO_HTTP_PORT)
```

For production, put a TLS-terminating proxy in front of the published port
and set `KANEO_CLIENT_URL=https://kaneo.example.com` and
`KANEO_API_URL=https://kaneo.example.com/api`. With an `https` API URL the
cookies become `Secure` and take the `__Secure-` prefix.

The backend records the client address on each sign-in session. It takes
that address from `X-Forwarded-For` only when the request comes from a proxy
listed in `TRUSTED_PROXIES`; `compose.yml` trusts the private Docker network,
since the frontend's nginx is the only way in. If you run the backend behind
another proxy, list that proxy's address there.

Images:

- `backend/Dockerfile`: pnpm install from the project's lockfile, `nest build`
  (SWC; copies `database/migrations/baseline.sql` into `dist`), then a runtime
  image with production dependencies only, running `node dist/main.js` as the
  unprivileged `node` user. `HEALTHCHECK` polls `/api/health`. Listens on
  `PORT` (1337 in the image).
- `frontend/Dockerfile`: `vite build` with the `VITE_API_URL` build argument
  (default empty), served by unprivileged nginx on 8080. Unknown paths fall
  back to `index.html`; `*.map` is refused; `/assets/*` (content-hashed) is
  cached for a year as immutable; `index.html` is `no-cache`. At start-up,
  `KANEO_API_UPSTREAM` (e.g. `http://backend:1337`) turns on the `/api/` and
  `/.well-known/` proxy; without it those paths answer 404.

nginx accepts request bodies up to 25 MB (the API's JSON limit). If you raise
`S3_MAX_IMAGE_UPLOAD_BYTES` above that, raise `client_max_body_size` in
`frontend/nginx/default.conf` too, and in any proxy in front.

Optional Redis: only for more than one backend instance. Uncomment the
`redis` service in `compose.yml` and set `REDIS_URL=redis://redis:6379`.

### Separately hosted frontend and backend

`compose.split.yml` overrides the frontend to call the API at its own public
URL, and publishes the backend:

```sh
# .env: VITE_API_URL, KANEO_CLIENT_URL, KANEO_API_URL (and CORS_ORIGINS if
# more than the client URL must call the API)
docker compose -f compose.yml -f compose.split.yml up -d --build
```

- `VITE_API_URL` is baked into the bundle at build time (with or without a
  trailing `/api`); rebuild the frontend image when it changes.
- `CORS_ORIGINS` defaults to `KANEO_CLIENT_URL`. Cookie-carrying writes from
  any other origin are refused (`403 INVALID_ORIGIN`), as are WebSocket
  handshakes from origins other than `KANEO_CLIENT_URL`, `KANEO_API_URL` and
  `CORS_ORIGINS`.
- `COOKIE_DOMAIN` is normally left unset: the httpOnly session cookies belong
  to the API host, which is the only one that reads them.

**Cookies need same-site hosting.** When the API and the app are on different
HTTPS hosts, the session cookies are sent as `SameSite=None; Secure;
Partitioned`. Browsers that block third-party cookies drop them unless both
hosts share a registrable parent domain (`app.example.com` +
`api.example.com` works; `example.com` + `example-api.net` does not). Over
plain HTTP the cookies stay `SameSite=Lax`, so only same-site hosts work at
all. Prefer the same-origin layout when you can.

## Migrating an existing Kaneo database

Point the v2 backend at the existing database with the same `AUTH_SECRET`
(and the same `NOTIFICATION_SECRET_ENCRYPTION_KEY`, if set) and start it. The
first migration, `Baseline1793000000000`, decides what to do:

- **Empty database:** it creates the full schema from `baseline.sql` (a
  structure-only dump of the previous schema, including the storage-cleanup
  triggers, partial indexes and composite foreign keys).
- **Database already upgraded by the previous backend 2.40.0** (its Drizzle
  history reaches the last migration, `0069_project_home`): it adopts the
  schema as-is, without touching any table, after checking that the old
  backend's startup fixups have run. Only the `typeorm_migrations` history
  table is added.
- **Older databases** are refused with a message: first upgrade to the
  previous backend 2.40.0 and boot it once so it finishes its own migrations
  and fixups, then start v2.
- A database with tables but no recognizable migration history is refused.

Later migrations are additive (e.g. `SessionJwt1793000000001` adds
`session.kind`, `previous_token` and `rotated_at`), so the old API can still
run against the same database during a cutover or rollback. TypeORM never
synchronizes or diffs the schema; `pnpm build && pnpm migration:run` (or
`node dist/database/run-migrations.js` in the image) applies migrations
without starting the server.

Note that the backend does not log which path the baseline took: verify an
adoption with `select * from typeorm_migrations` (two rows) and by checking
that existing row counts are unchanged.

Users stay signed in: a request carrying the previous backend's signed
`better-auth.session_token` cookie (verified with `AUTH_SECRET`) is upgraded
to the new `kaneo.access_token` / `kaneo.refresh_token` cookies, and the old
cookie is cleared. This only works if `AUTH_SECRET` is unchanged.

Settings that the old web container read (`KANEO_TURNSTILE_SITE_KEY`, Sentry,
Plausible) now go to the backend, which hands them to the app through
`/api/config`.

## Contract changes from the previous API

These are deliberate; other routes keep their previous shape.

- **Uploads are multipart.** Files are sent to the API as
  `multipart/form-data` instead of a presigned S3 PUT followed by a finalize
  call: `POST /api/task/image-upload/{id}`,
  `POST /api/task/draft-upload/{projectId}`,
  `POST /api/project/{id}/background-upload`. The browser no longer talks to
  S3, so the bucket needs no CORS rule; the size cap is
  `S3_MAX_IMAGE_UPLOAD_BYTES`.
- **Short-lived access tokens with refresh.** Sign-in sets an httpOnly
  `kaneo.access_token` (path `/api`, `AUTH_ACCESS_TTL_SECONDS`, default 300)
  and a rotating `kaneo.refresh_token` (path `/api/auth`).
  `POST /api/auth/refresh` issues a new access token; the app calls it when a
  request answers 401. A refresh token reused after its short rotation grace
  window is treated as theft.
- **`GET /api/config`** adds `turnstileSiteKey`, `sentryDsn`,
  `sentryEnvironment` and `analytics` (`{ plausibleDomain, scriptUrl }` or
  null), replacing the old web image's runtime environment injection.
- **`/.well-known/` is served by the backend**: the MCP OAuth discovery
  documents (`/.well-known/oauth-protected-resource/api/mcp`,
  `/.well-known/oauth-authorization-server/api`, also under `/api/`). A
  reverse proxy must forward `/.well-known/` to the backend, as the frontend
  nginx does.

## Environment reference

`v2/.env.example` lists every backend variable, grouped and commented; the
same variables apply outside Docker. The essentials:

| Variable | Notes |
| --- | --- |
| `AUTH_SECRET` (or `AUTH_SECRET_FILE`) | Required, 32+ characters. Keep the old value when migrating. |
| `DATABASE_URL` | Or `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` (or `POSTGRES_PASSWORD_FILE`). Without either, `postgresql://localhost:5432/kaneo`. |
| `KANEO_CLIENT_URL` | Public app URL: CORS, WebSocket origin, email links, OAuth return. |
| `KANEO_API_URL` | Public API URL (with or without `/api`): cookie flags, OAuth callbacks (`<origin>/api/auth/callback/<provider>`), MCP discovery, asset URLs. |
| `CORS_ORIGINS` | Comma-separated; defaults to `KANEO_CLIENT_URL`. |
| `COOKIE_DOMAIN` | Optional `Domain` for the session cookies. |
| `PORT` | Backend listen port, default 1337. |
| `REDIS_URL` / `REDIS_SENTINELS` / `REDIS_CLUSTER_NODES` | Optional realtime fan-out across instances. |
| `SMTP_*` | Email; on when `SMTP_HOST` and `SMTP_FROM` are set. |
| `S3_*` | File storage; on when `S3_ENDPOINT` and `S3_BUCKET` are set. |
| `DISABLE_*`, `DEMO_MODE`, `TURNSTILE_*` | Registration and sign-in policy. |
| `GITHUB_OAUTH_*`, `GOOGLE_*`, `DISCORD_*`, `CUSTOM_OAUTH_*` | Social and OIDC sign-in. |
| `SENTRY_WEB_DSN`, `SENTRY_ENVIRONMENT`, `PLAUSIBLE_*` | Passed to the app via `/api/config`. |
| `KANEO_CLOUD`, `CREEM_*`, `BILLING_*` | Kaneo Cloud billing only. |

The frontend has one variable, `VITE_API_URL`, read at build time.
