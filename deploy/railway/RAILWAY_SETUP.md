# Deploy Kaneo on Railway (from this GitHub repo)

Railway needs **two services**: your app **and** a PostgreSQL database. The database is not created automatically when you connect GitHub.

## 1. Create the app service

1. [Railway](https://railway.com) → **New Project** → **Deploy from GitHub** → select this repository.
2. Railway should pick up root **`railway.toml`** and build **`Dockerfile.kaneo`** (first build can take 10–20 minutes).
3. **Settings → Networking** → **Generate domain** → set the public port to **`5173`**.

## 2. Add PostgreSQL (required)

1. In the same project, click **+ New** → **Database** → **PostgreSQL**.
2. Wait until Postgres shows as running.
3. Open the **Postgres** service → **Variables** → confirm **`DATABASE_URL`** exists (Railway creates it).

Optional on Postgres (recommended):

```env
PGDATA=/var/lib/postgresql/data/pgdata
```

## 3. Wire the Kaneo service to Postgres

Open your **Kaneo** service (the GitHub deploy, not Postgres) → **Variables** → **Add**:

| Variable | Value |
|----------|--------|
| `KANEO_CLIENT_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `AUTH_SECRET` | 64-char hex from `openssl rand -hex 32` (mark as **secret**) |
| `PORT` | `5173` |

Replace **`Postgres`** in `${{Postgres.DATABASE_URL}}` with your database service name if you renamed it (click the Postgres service → **Settings** → name).

Do **not** commit `.env` or paste production secrets into GitHub.

## 4. Redeploy

After variables are saved, **Redeploy** the Kaneo service. Check **Deployments → View logs** for:

- `Database migrated successfully`
- `API is running`
- nginx listening on 5173

Health check path: **`/api/health`**.

## 5. Open the app

Use the generated **https://…railway.app** URL. Create the first account, then optionally set `DISABLE_REGISTRATION=true` and redeploy.

## Split API + web (optional)

Use `deploy/railway/api.railway.toml` and `deploy/railway/web.railway.toml` on two services instead of `Dockerfile.kaneo`. See `variables.split.example`.

## Still seeing localhost?

- Kaneo service is missing **`DATABASE_URL`** or **`KANEO_CLIENT_URL`** → add variables and redeploy.
- Only one service in the project → add **PostgreSQL** (step 2).
- Wrong builder → service must use **Dockerfile** / `Dockerfile.kaneo`, not Nixpacks with `pnpm dev`.
