# Split web + API on Railway

Use **`deploy/railway/web.railway.toml`** on the public web service and **`deploy/railway/api.railway.toml`** on the API service. Postgres stays a third service.

## How uploads work

1. Browser asks the **API** for a presigned upload URL.
2. Browser **PUTs the file directly to S3** (not through the API body).
3. Browser calls the API to **finalize**; the API checks the object in S3.

So **S3 variables belong on the API service**. The web service does not need `S3_*` keys.

## API (backend) service variables

Replace service names in `${{…}}` references to match your Railway project.

```env
# Same secret on web + API (sessions and auth cookies)
AUTH_SECRET=<openssl rand -hex 32>

DATABASE_URL=${{Postgres.DATABASE_URL}}

# Public URLs — use your real domains
KANEO_CLIENT_URL=https://kaneoweb-production.up.railway.app
KANEO_API_URL=https://YOUR-API-SERVICE.up.railway.app

# Split origin: web and API are different hostnames
CORS_ORIGINS=https://kaneoweb-production.up.railway.app

# Railway sets PORT; the API listens on PORT (defaults to 1337 locally).
# Do not copy PORT=5173 from the web service — that port is for the web container only.

# Invitations — see smtp.env.example
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=resend
SMTP_PASSWORD=<Resend API key — secret>
SMTP_FROM=Kaneo <noreply@your-verified-domain.com>

# Optional: keep password sign-in when SMTP is enabled
# DISABLE_EMAIL_OTP_SIGN_IN=true

# Attachments — see s3.env.example
S3_ENDPOINT=https://s3.eu-north-1.amazonaws.com
S3_BUCKET=kaneo-storage
S3_ACCESS_KEY_ID=<secret>
S3_SECRET_ACCESS_KEY=<secret>
S3_REGION=eu-north-1
S3_FORCE_PATH_STYLE=false
```

**Networking:** generate a public domain on the **API** service and set Railway’s target port to match what the process listens on (Railway’s injected `PORT`, or **1337** if you unset `PORT`).

**Resend:** `onboarding@resend.dev` only delivers to your Resend account email. Verify a domain for real invitations.

## Web service variables

```env
KANEO_CLIENT_URL=https://kaneoweb-production.up.railway.app
KANEO_API_URL=${{YOUR-API-SERVICE.KANEO_API_URL}}
PORT=5173
AUTH_SECRET=${{YOUR-API-SERVICE.AUTH_SECRET}}
```

Public networking on the web service: port **5173**, health check `/`.

## Checklist

1. Redeploy **API** after adding SMTP + S3.
2. Redeploy **web** after `KANEO_API_URL` points at the API domain.
3. S3 bucket **CORS** includes the web origin (see `s3.env.example`).
4. IAM user can `PutObject`, `GetObject`, `DeleteObject` on the bucket.
5. Test: invite by email, attach a file on a task.
