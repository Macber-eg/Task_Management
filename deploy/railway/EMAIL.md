# Email (SMTP) for invitations and auth

Kaneo sends **workspace invitation** emails through SMTP when you invite someone from **Team → Invite**. No extra code is required — configure these environment variables on the **Kaneo / API** service and redeploy.

## Required variables

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` | SMTP server hostname |
| `SMTP_FROM` | From address (must be allowed by your provider) |
| `SMTP_USER` / `SMTP_PASSWORD` | If your relay requires authentication |
| `SMTP_PORT` | Usually `465` (TLS) or `587` (STARTTLS) |
| `SMTP_SECURE` | `true` for port 465; `false` for 587 + STARTTLS |
| `KANEO_CLIENT_URL` | Public app URL — used in invitation links |

Copy provider examples from [`smtp.env.example`](./smtp.env.example).

## Railway

1. Open your **Kaneo** service (not Postgres).
2. **Variables** → paste SMTP settings (mark secrets as **Secret**).
3. Confirm `KANEO_CLIENT_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}`.
4. **Redeploy** and send a test invite from the UI.

Check **Deploy logs** after an invite. If SMTP is missing you will see:

`Invitation created but email not sent due to SMTP not being configured`

## Local development

Add SMTP variables to the root **`.env`** (API reads it). For a fake inbox, run [Mailpit](https://github.com/axllent/mailpit) locally:

```bash
docker run -d --name mailpit -p 8025:8025 -p 1025:1025 axllent/mailpit
```

```env
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_REQUIRE_TLS=false
SMTP_FROM=Kaneo <dev@localhost>
```

Open http://localhost:8025 to read messages. Leave `SMTP_USER` and `SMTP_PASSWORD` unset for Mailpit.

## Behaviour notes

- Invitations are created in the database even if email fails; without SMTP the UI shows a **copy link** instead.
- With SMTP enabled, **sign-in uses email verification codes** by default. Set `DISABLE_EMAIL_OTP_SIGN_IN=true` to keep password sign-in.
- `SMTP_FROM` must match a domain or sender verified with your email provider.

Official reference: [Environment variables — SMTP](https://kaneo.app/docs/core/installation/environment-variables#smtp-configuration).
