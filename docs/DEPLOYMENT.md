# Production deployment

## Vercel deployment

The live application is **https://vs-partnerhub.vercel.app**. `vercel.json` deploys the React frontend and `api/index.ts` together, including direct navigation to login, password recovery and workspace routes. The API runs in Singapore with the connected Neon PostgreSQL database and a **private** Vercel Blob store. Local SQLite accounts and files are not automatically copied to production; operator-provisioned accounts are separate from ordinary email-verified partner registration.

Production requires `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (migrations), `DATABASE_SSL=true`, `FILE_STORAGE=blob`, `BLOB_READ_WRITE_TOKEN`, `APP_URL`, `SESSION_SECRET`, `INTEGRATION_ENCRYPTION_KEY`, `CRON_SECRET` and `TRUST_PROXY=1`. Configure Gemini through `GEMINI_API_KEY` and `GEMINI_MODEL`. Sensitive values belong in Vercel environment settings; `.vercelignore` also excludes local secrets, databases, uploads and verification artifacts from CLI deployments.

The production build runs database migrations before releasing the function. Cold starts do not seed data or migrate schemas. PostgreSQL stores users, password hashes, sessions, OTP/reset token hashes, organization profiles, workflows and audit records. Shared request limits and scheduled-job leases also use PostgreSQL, so they work across function instances.

Document uploads use a short-lived, single-path token to upload up to 10 MB directly to private storage. The API then rechecks the user's permissions, file size and file signature, and saves a separate immutable document. Download, extraction and signature routes retain their existing authorization checks and stream/read the private file through the server. Staging objects are cleaned after their upload tokens expire.

The function explicitly retains background email/webhook work with `waitUntil`. Security emails begin delivery during the authentication request. A daily authenticated Vercel cron handles expiry/retention work when the site is idle; active traffic also checks hourly maintenance and queued retries. The cron route requires the configured bearer secret. Node's permanent worker timers are used only for conventional Node/Docker hosting.

For real verification and recovery emails, set `RESEND_API_KEY`, `MAIL_FROM` and optionally `MAIL_REPLY_TO`, or configure SMTP below. Use a company domain verified by the email provider; confirm SPF/DKIM and DMARC alignment, then test actual delivery to the intended inboxes. A working password login does not establish that external email delivery has been configured.

Use `vercel deploy --prod --skip-domain` to validate a production build before promoting it. `vercel curl` can access a protected deployment for authorized checks. Promote a verified deployment with `vercel promote <deployment-url>`; pushes to the connected `main` branch also deploy. Bootstrap an administrator only once using the operator-controlled CLI and an authorized email address. Deployment never creates a default account, and local demonstration credentials are excluded from the production browser bundle.

`npm run test:cloud` exercises real private Blob uploads, authorization, tampering, replay and restart persistence with a disposable local account database. It reads Blob credentials from the ignored `.env.production.local` (or `CLOUD_ENV_FILE`), removes its cloud test objects and writes `artifacts/local-verification/cloud-storage-report.json`.

## Configure a clean environment

Use a supported Node.js release at or above 22.21, PostgreSQL, persistent private file storage and an HTTPS reverse proxy. Start with an empty production database and upload directory. Local demo data is fictional and should stay in local development.

Create `.env` from `.env.example`, then set:

| Variable                                  | Production value                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                | `production`                                                                                          |
| `DEMO_MODE`                               | `false` (production also disables it unconditionally)                                                 |
| `APP_URL`                                 | The exact public HTTPS origin, for example `https://partners.company.com`                             |
| `SESSION_SECRET`                          | At least 32 cryptographically random characters; `openssl rand -hex 32` is suitable                   |
| `INTEGRATION_ENCRYPTION_KEY`              | Independent 32-byte encryption secret for saved provider credentials; retain it securely for recovery |
| `GEMINI_API_KEY`, `GEMINI_MODEL`          | Authorized Google project key and available model, default `gemini-3.5-flash-lite`                    |
| `DATABASE_URL`                            | PostgreSQL connection URI for a dedicated application database/user                                   |
| `DATABASE_SSL`                            | `true` for a database requiring certificate-verified TLS                                              |
| `UPLOAD_DIR`                              | Persistent private directory, outside the public web root                                             |
| `HOST`                                    | `127.0.0.1` behind a host proxy, or `0.0.0.0` inside Docker                                           |
| `PORT`                                    | `4000` by default                                                                                     |
| `TRUST_PROXY`                             | `1` only behind one trusted proxy that overwrites forwarded headers; otherwise `0`                    |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`   | Email provider settings, commonly port 587 with STARTTLS or 465 with `true`                           |
| `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | Provider credentials and an authorized sender                                                         |

Keep credentials in a deployment secret store or a restricted `.env`, never in the repository. `DATABASE_SSL=true` verifies the database certificate; use `NODE_EXTRA_CA_CERTS` for a private CA when necessary. Do not disable certificate validation.

## Docker and PostgreSQL

`compose.yaml` provisions PostgreSQL 18 and a non-root application container. Database and uploads use named volumes. The application port is bound to host loopback for use with a TLS proxy. The database is not published to the host network.

For Compose, add `POSTGRES_PASSWORD` to `.env` using a long random hexadecimal value. This avoids reserved URI characters when constructing the database connection string. Set `APP_URL`, `SESSION_SECRET`, SMTP settings and proxy settings as above.

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 app
```

Bootstrap the first administrator once. The following shell variables must be set securely in the deployment session; the `-e NAME` syntax forwards their values without embedding a password in command history:

```sh
docker compose exec -e ADMIN_EMAIL -e ADMIN_PASSWORD -e ADMIN_NAME app node build/server/cli.js admin
```

Use a unique password of at least 12 characters including uppercase, lowercase and a number. The bootstrap command refuses to overwrite an existing account. Remove `ADMIN_PASSWORD` from the deployment environment after use. Sign in at the HTTPS URL, enable email sign-in verification and invite the internal VS teams with their proper roles.

## Direct Node deployment

```sh
npm ci
npm run check
npm run build
npm run db:migrate
npm run admin:create
npm start
```

Set the production environment before these commands. If deploying a pruned production installation, run the compiled CLI as `node build/server/cli.js migrate` or `node build/server/cli.js admin`; the source CLI requires the development `tsx` dependency. Run the server under a process manager/system service and a dedicated non-root account. Grant that account access only to its database and private upload directory.

## HTTPS proxy

Terminate TLS at your load balancer or reverse proxy, forward requests to `127.0.0.1:4000`, preserve `Host`, and overwrite `X-Forwarded-Proto`/`X-Forwarded-For`. Use at least an 11 MB request body limit for a 10 MB file plus multipart overhead. WebSocket configuration is unnecessary for the production frontend. Document extraction uses server-sent events over POST; disable proxy response buffering for `/api/ai/extract-document` and allow at least a 95-second read timeout so actual progress and terminal errors reach the browser.

`APP_URL` must match the browser origin; otherwise mutation requests are rejected by CSRF protection. The production session cookie uses `Secure`, so authentication must be reviewed through HTTPS. HTTP access to the API can be used for health probes only.

Example Nginx location inside an existing TLS-enabled server block:

```nginx
client_max_body_size 11m;
location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
}
```

## Email and scheduled work

Email verification, resets and optional sign-in codes need working SMTP or Resend. The local demo retains messages in a local outbox and shows test codes/links; production does not expose these values. Verify the provider's sender/domain configuration, SPF/DKIM and delivery logs with an approved test mailbox before inviting employees.

Conventional Node hosting polls queued mail every 15 seconds and runs expiry/retention maintenance at startup and hourly. Vercel retains delivery with `waitUntil`, checks queues during traffic and uses a daily authenticated cron for idle periods. Both use database row claims, job leases and up to five attempts for temporary delivery failures. Failed messages can be retried by a Super Admin in Settings → Email delivery. Delivery is at-least-once: the same message may be delivered again after an interrupted send.

Multiple instances require PostgreSQL and shared private document storage. The live Vercel configuration supplies both, plus database-backed rate limiting. Keep migrations in the controlled release build and use bounded database pools. Local SQLite and private-directory configurations are intended for one process.

## Rollout validation

Check `/api/health`, login/logout, email verification/reset/sign-in codes, an upload/download, the configured company review process, one complete procurement transaction and recruitment workflow. Review the organization/role configuration and the Terms/Privacy content for company policy. Test a backup restoration as described in [OPERATIONS.md](OPERATIONS.md).

Security headers, cookie configuration, production demo suppression, persistent restart and SQLite backup are covered by `npm run test:production`. TLS termination, cloud permissions, Docker runtime configuration, real email delivery, database HA and off-site recovery must also be verified in the chosen hosting environment.
