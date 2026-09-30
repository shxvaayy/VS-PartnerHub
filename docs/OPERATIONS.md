# Operations and recovery

## Routine operations

| Task                    | Procedure                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Health                  | Probe `/api/health`; HTTP 200 means the API can query its database                                                |
| Company approval        | Verification center → inspect documents → approve required current versions → approve company                     |
| Clarification           | Add an actionable note; partner updates the profile/documents and resubmits                                       |
| Document renewal        | Use Renew on an existing document; the replacement is a new reviewable version                                    |
| Contract renewal        | Add a new end date and amendment note; the contract returns to review                                             |
| User access             | Invite through People & access; suspend compromised accounts and review their audit history                       |
| Email                   | Super Admin → Integrations → Email delivery; inspect failure counts and retry after fixing provider configuration |
| Expiry/retention worker | Runs at startup/hourly; run `npm run maintenance` or the compiled CLI for an explicit maintenance pass            |
| Release                 | Back up, run checks, build, apply migrations, restart and verify health/core flows                                |

The development server uses Vite and a watched API. `npm start` serves the compiled production frontend and API together. Migrations run at startup and are serialized by Knex's migration lock. Destructive rollback is unsupported; deploy a compatible fix or restore a verified backup into a clean environment.

## What to back up

Database **and** private uploads form one backup set. Include the deployed revision, environment configuration references and encryption-key recovery procedure. Store secrets separately from ordinary data archives. Use encrypted off-site storage with restricted access, retention and restore testing.

Pause application writes while taking the pair so database metadata and files agree. Never copy only a live SQLite file: WAL transactions may not yet be checkpointed.

## SQLite

```sh
npm run db:backup
```

The command uses SQLite `VACUUM INTO` for a consistent snapshot and writes a uniquely named file under `backups/`. Copy `UPLOAD_DIR` with that snapshot during the same write-pause window. The generated backup path is printed by the CLI. The production smoke test opens a generated backup read-only, checks `PRAGMA integrity_check` and verifies a persisted record, then boots the application from that backup and reads the record through its authenticated API.

To restore, stop the application and configure a **new** `SQLITE_PATH` and `UPLOAD_DIR` containing the matched backup set. Keep the existing database and files intact until the restored instance has passed verification. Start the restored revision, inspect migrations/health, sign in and download sample documents.

## PostgreSQL / Docker Compose

Use a database-consistent dump and the matching upload volume. This example creates a fresh backup directory and pauses the application container:

```sh
PARTNERHUB_BACKUP_DIR="backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$PARTNERHUB_BACKUP_DIR"
docker compose stop app
docker compose exec -T db pg_dump -U partnerhub -d partnerhub --format=custom > "$PARTNERHUB_BACKUP_DIR/database.dump"
docker compose cp app:/app/uploads "$PARTNERHUB_BACKUP_DIR/uploads"
docker compose start app
```

Confirm both the dump and upload copy succeeded before treating the directory as a backup. If a command fails, resolve it and restart the application deliberately. Record checksums and the Git commit identifier, then copy the set off-site. Managed PostgreSQL installations should also enable point-in-time recovery with the hosting provider.

For a native PostgreSQL installation, use `pg_dump --format=custom --file=database.dump` with a configured `PGSERVICE` or `PGHOST`/`PGUSER`/`PGDATABASE` and a restricted password file. Keep connection passwords out of command-line arguments.

Restore into a new, empty PostgreSQL database using `pg_restore --no-owner --no-privileges --dbname=partnerhub_restored database.dump` with appropriate environment credentials. Restore uploads to a new private directory and point an isolated application instance at both. Never run the test suite against this restored business database.

## Restore verification

1. Confirm database integrity and expected organization/user/record/document counts.
2. Sign in with an authorized account and check its permitted workspace.
3. Inspect one quote/order/invoice/payment chain and its audit history.
4. Download a sample company document and a record attachment.
5. Verify a recruitment record, interview and version history.
6. Confirm SMTP and maintenance configuration. Keep external messages disabled in a restore rehearsal.
7. Document the measured recovery time and backup date before switching production traffic.

The repository does not prescribe an untested RPO/RTO. Choose backup frequency and recovery objectives with the business owner and measure them in deployment drills.

## Maintenance and retention

Document reminders default to 90/60/30 days and expiry, with deduplicated notifications. Contract reminders use the contract's notice period. Expired approved company documents are marked expired. Expired contracts cannot continue through ordinary approval transitions without a reviewed renewal.

Candidate retention defaults to 365 days. The server records a retention deadline on submission. After it passes, only closed/joined candidates are anonymized; related interview payloads, document metadata/files, comments and versions are removed. Active recruitment is preserved. Adjusting the setting governs newly captured deadlines; review existing retention schedules under the company's policy.

Audit retention defaults to a seven-year minimum policy. Logs are not automatically purged. Administrators should archive them under the approved legal/records procedure. Operational backups and replicas need matching retention rules; removing a live record cannot erase historic backups.

## Incident handling

Suspend an affected user/organization, preserve the relevant audit range and application/database logs, and investigate using restricted access. Fix the root cause, reset affected passwords and restore access through an authorized administrator. Review provider credentials and rotate any exposed secrets. Avoid exporting unnecessary candidate/KYC data into tickets or public issues.

Monitor health failures, 5xx responses, SMTP failures, disk space, backup results, database connection usage and document-expiry volume. Per-process rate limits and in-process workers require a single designated runtime until distributed infrastructure is added.

## AI operations

Keep the Google credential and `INTEGRATION_ENCRYPTION_KEY` in the deployment secret store. Monitor failed/cancelled requests, provider capacity and document-reader load. A capacity response does not imply a completed analysis; the user can retry and ordinary direct-data queries remain available. Do not rotate the encryption key without decrypting/re-encrypting stored provider settings under a controlled procedure.

AI history is private to the creator; source access is rechecked on reads. Users can delete conversations and unreviewed extractions. Human-reviewed extraction evidence is retained with the compliance decision. Unchanged private analyses are reusable for 15 minutes; document reuse is bound to content hash/version and fresh validation. Candidate retention removes linked personal AI content. Review retention of other AI history and backups under the organization policy.

Deployments with a proxy must allow the document extraction event stream to flush (`proxy_buffering off` for that endpoint) and permit the 90-second processing deadline. A browser disconnect cancels pending generation; no fabricated successful response is saved.
