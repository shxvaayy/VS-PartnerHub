# Production deployment

## Configure a clean environment

Use a supported Node.js release at or above 22.21, PostgreSQL, persistent private file storage and an HTTPS reverse proxy. Start with an empty production database and upload directory. Local demo data is fictional and should stay in local development.

Create `.env` from `.env.example`, then set:

| Variable                                  | Production value                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| `NODE_ENV`                                | `production`                                                                        |
| `DEMO_MODE`                               | `false` (production also disables it unconditionally)                               |
| `APP_URL`                                 | The exact public HTTPS origin, for example `https://partners.company.com`           |
| `SESSION_SECRET`                          | At least 32 cryptographically random characters; `openssl rand -hex 32` is suitable |
| `DATABASE_URL`                            | PostgreSQL connection URI for a dedicated application database/user                 |
| `DATABASE_SSL`                            | `true` for a database requiring certificate-verified TLS                            |
| `UPLOAD_DIR`                              | Persistent private directory, outside the public web root                           |
| `HOST`                                    | `127.0.0.1` behind a host proxy, or `0.0.0.0` inside Docker                         |
| `PORT`                                    | `4000` by default                                                                   |
| `TRUST_PROXY`                             | `1` only behind one trusted proxy that overwrites forwarded headers; otherwise `0`  |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`   | Email provider settings, commonly port 587 with STARTTLS or 465 with `true`         |
| `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | Provider credentials and an authorized sender                                       |

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

Terminate TLS at your load balancer or reverse proxy, forward requests to `127.0.0.1:4000`, preserve `Host`, and overwrite `X-Forwarded-Proto`/`X-Forwarded-For`. Use at least an 11 MB request body limit for a 10 MB file plus multipart overhead. WebSocket configuration is unnecessary for the production frontend.

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

Email verification, resets and optional sign-in codes need working SMTP. The local demo retains messages in a local outbox and shows test codes/links; production does not expose these values. Verify the provider's sender/domain configuration, SPF/DKIM and delivery logs with an approved test mailbox before inviting employees.

The application sends queued mail every 15 seconds, uses row claims and retries temporary failures up to five attempts. Expiry/retention maintenance runs at startup and hourly. Failed messages can be retried by a Super Admin in Settings → Email delivery. SMTP delivery is at-least-once: the same message may be delivered again after an interrupted send.

Run a single application instance with the supplied configuration. For horizontal scaling, introduce a designated maintenance worker, shared upload storage and distributed rate limits first.

## Rollout validation

Check `/api/health`, login/logout, email verification/reset/sign-in codes, an upload/download, the configured company review process, one complete procurement transaction and recruitment workflow. Review the organization/role configuration and the Terms/Privacy content for company policy. Test a backup restoration as described in [OPERATIONS.md](OPERATIONS.md).

Security headers, cookie configuration, production demo suppression, persistent restart and SQLite backup are covered by `npm run test:production`. TLS termination, cloud permissions, Docker runtime configuration, real email delivery, database HA and off-site recovery must also be verified in the chosen hosting environment.
