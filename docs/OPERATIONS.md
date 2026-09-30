# Operations and recovery

## Routine operations

| Task                    | Procedure                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Health                  | Probe `/api/health`; HTTP 200 means the API can query its database                                                   |
| Company approval        | Verification center → inspect documents → approve required current versions → approve company                        |
| Clarification           | Add an actionable note; partner updates the profile/documents and resubmits                                          |
| Document renewal        | Use Renew on an existing document; the replacement is a new reviewable version                                       |
| Contract renewal        | Add a new end date and amendment note; the contract returns to review                                                |
| User access             | Invite through People & access; suspend compromised accounts and review their audit history                          |
| Email                   | Super Admin → Integrations → Email delivery; inspect failure counts and retry after fixing provider configuration    |
| Expiry/retention worker | Vercel: hourly checks during traffic plus daily authenticated cron. Node: startup/hourly. CLI: `npm run maintenance` |
| Release                 | Back up, run checks, build, apply migrations, restart and verify health/core flows                                   |

The development server uses Vite and a watched API. `npm start` serves the compiled production frontend and API together. Conventional Node hosting applies migrations at startup; Vercel applies them during the release build before publishing functions. Knex serializes migrations with its migration lock. Destructive rollback is unsupported; deploy a compatible fix or restore a verified backup into a clean environment.

## What to back up

Database **and** private uploads form one backup set. Include the deployed revision, environment configuration references and encryption-key recovery procedure. Store secrets separately from ordinary data archives. Use encrypted off-site storage with restricted access, retention and restore testing.

Use the coordinated command below. It reads a consistent database snapshot and copies the immutable document and company-logo objects referenced by that snapshot. A missing object or size mismatch fails the backup; it never publishes a partial set. Pause concurrent file deletion/retention work if it prevents a complete capture. Never copy only a live SQLite file: WAL transactions may not yet be checkpointed.

## Coordinated encrypted backup

Generate a recovery key once in a restricted directory and preserve it separately in the organization's approved secret store:

```sh
npm run recovery:keygen -- --key /private/keys/partnerhub-recovery.key
npm run recovery:backup -- --key /private/keys/partnerhub-recovery.key --output backups/release.vshub
```

The command uses the same database/file configuration as the application (`DATABASE_URL` or `SQLITE_PATH`, plus `FILE_STORAGE`, `UPLOAD_DIR` or private Blob credentials). `DOTENV_CONFIG_PATH` can select a protected configuration file. `BACKUP_REVISION` overrides the source revision; otherwise the command uses `VERCEL_GIT_COMMIT_SHA` or the current checkout's Git revision. When backing up a different release, set its deployed revision explicitly.

For PostgreSQL, install client tools at least as new as the database server and use `PG_BIN` if they are outside `PATH`. The command opens a read-only repeatable-read transaction, exports its snapshot, reads table counts/document references and runs `pg_dump` against the **same snapshot**. It includes the application's `public` schema. Remote connections require certificate verification; `PGSSLROOTCERT` can specify the approved CA bundle. Passwords are passed to the subprocess through its environment, never command-line arguments. The backup never imports the application's database initializer or runs migrations, seeding, maintenance, email or webhook delivery.

The archive contains a database dump, referenced document/logo bytes and a manifest with capture start/end times, source revision, database version, table counts, sizes and SHA-256 hashes. It is a gzip-compressed TAR encrypted with AES-256-GCM and a fresh nonce. The header and ciphertext are authenticated. Temporary files/directories are private (`0600`/`0700`) and removed when the operation finishes. Publishing is atomic and refuses to replace an existing backup. Keep the independent `INTEGRATION_ENCRYPTION_KEY` recoverable too: provider settings inside the database remain encrypted with that application key.

Incomplete browser-upload staging objects are transient and are not included as finalized documents. After recovery, users must retry unfinished uploads. The archive format supports up to 99,998 finalized document/logo files and a 32 MB manifest; larger sets fail explicitly instead of publishing an unrestorable set. Restore defaults to a 20 GiB size limit; `--max-bytes` can increase it after checking destination capacity.

This command creates the backup artifact. Configure an approved off-site destination, retention policy, schedule, failure alerts and recovery-key escrow separately; a local file is not an independent disaster-recovery copy.

## Authenticate and unpack

```sh
npm run recovery:unpack -- --key /private/keys/partnerhub-recovery.key --input backups/release.vshub --destination /private/restores/new-release
```

The destination must not exist. The command authenticates the complete ciphertext **before** examining or extracting the archive, rejects traversal paths, links, duplicate/oversized entries and manifest mismatches, and verifies every database/file hash. It never connects to a database, changes an existing destination or starts the application. Failed verification removes its partial destination.

For SQLite, use the unpacked `database.sqlite` and `uploads/` in an isolated instance. For PostgreSQL, create a new empty database, then restore `database.dump` with `pg_restore --exit-on-error --single-transaction --no-owner --no-privileges`. The dump includes `CREATE SCHEMA public`; remove only the empty default `public` schema in that newly created target first. Do not use `CASCADE` or point this procedure at an existing business database. Keep the original deployment intact until all verification steps pass.

## Rehearse a PostgreSQL restore

With PostgreSQL server/client tools available locally, this command creates its **own** password-protected loopback cluster and new database, restores the archive and checks it through the application:

```sh
npm run recovery:verify -- --input backups/release.vshub --key /private/keys/partnerhub-recovery.key --credentials /private/review-account.json
```

The credentials file contains the email/password of an authorized internal review account already in that backup and should be `0600`. A password account is required for this drill; the runner does not bypass MFA or send live verification emails. It checks all captured table counts, indexes, document/logo references, existing login and role permissions, dashboard/audit APIs, available module records/history and private download hashes, including anonymous denial. It deliberately never imports `server/index.ts`, which starts background workers.

Before starting the restored API, the runner clears **only the temporary clone's** delivery credentials, email/webhook queues, sessions, auth challenges/attempts, upload tickets and job leases; it disables cloned webhook endpoints and integration tokens. It also uses a fresh session secret, local files and no external provider credentials. The original backup and source are unchanged. The temporary cluster and decrypted files are removed afterward. The JSON report contains counts/checks, not source credentials or document content.

For repeatable transaction-rich test data without touching business databases:

```sh
npm run recovery:verify -- --fixture --output artifacts/recovery-verification/fixture-restore.json
```

This mode creates, seeds, backs up and restores a separate local PostgreSQL database. Reports identify it as synthetic fixtures. It is distinct from the live-source recovery evidence.

## SQLite

```sh
npm run db:backup
```

This legacy database-only command opens the existing source read-only and uses SQLite's online backup API, including committed WAL transactions. It normalizes only the copy into a standalone database and checks integrity before reporting success. It never migrates the source, creates internal accounts or creates an absent source database. It writes a unique file under `backups/`; use `recovery:backup` for an encrypted set including private files. The production smoke test opens the snapshot read-only, verifies a persisted record, then boots the application from that backup and reads the record through its authenticated API.

To restore, stop the application and configure a **new** `SQLITE_PATH` and `UPLOAD_DIR` containing the matched backup set. Keep the existing database and files intact until the restored instance has passed verification. Start the restored revision, inspect migrations/health, sign in and download sample documents.

## PostgreSQL / Docker Compose

The coordinated encrypted command is preferred when the host has PostgreSQL client tools and access to the private file store. For a manual Docker backup, use a database-consistent dump and matching upload volume. This example creates a fresh backup directory and pauses the application container:

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

The due-day notice and the notice after expiry are distinct. Existing expiry notices from earlier releases remain deduplicated. The worker reloads and locks each current record before deciding; a concurrent verification rejection, superseding upload, contract renewal or termination cannot be replaced by a stale expiry decision. Document policy definitions are shared within each maintenance run instead of being reloaded for every document.

Candidate retention defaults to 365 days. The server records a retention deadline on submission. After it passes, only closed/joined candidates are anonymized; related interview payloads, document metadata/files, comments and versions are removed. Active recruitment is preserved. Adjusting the setting governs newly captured deadlines; review existing retention schedules under the company's policy.

Audit retention defaults to a seven-year minimum policy. Logs are not automatically purged. Administrators should archive them under the approved legal/records procedure. Operational backups and replicas need matching retention rules; removing a live record cannot erase historic backups.

## Incident handling

Suspend an affected user/organization, preserve the relevant audit range and application/database logs, and investigate using restricted access. Fix the root cause, reset affected passwords and restore access through an authorized administrator. Review provider credentials and rotate any exposed secrets. Avoid exporting unnecessary candidate/KYC data into tickets or public issues.

Monitor health failures, 5xx responses, email failures, storage capacity, backup results, database connection usage and document-expiry volume. The Vercel deployment uses shared PostgreSQL request limits, database job leases and private Blob storage. Review cron execution and outbox retries as well as request logs; a healthy HTTP response alone does not verify background delivery. Conventional SQLite/local-file hosting remains a single-process configuration.

## Managed PostgreSQL and private Blob recovery

The live deployment stores metadata in Neon PostgreSQL and document bytes in private Vercel Blob. Preserve both as a coordinated backup set. Use the provider's approved database backup/restore tooling or a certificate-verified `pg_dump`, and export the private objects referenced by the corresponding document metadata. Include immutable document hashes and the deployed revision in the manifest. Staging upload objects are temporary and are not substitutes for finalized documents.

On 30 September 2026, a read-only snapshot of the live Neon database and its referenced private Blob document was encrypted and restored into an isolated local PostgreSQL cluster. All 42 table counts matched; existing password authentication, restored permissions and an authorized private download passed, while anonymous access was denied (7 checks). The live snapshot contained no business transactions or company logos. Separately, a synthetic PostgreSQL fixture restored 64 private documents and checked module records/history (24 checks). These results prove the recorded local recoveries, not off-site availability or a recovery SLA. The off-site destination, retention/schedule, monitoring owner and recovery objectives remain operational requirements.

## AI operations

Keep the Google credential and `INTEGRATION_ENCRYPTION_KEY` in the deployment secret store. Monitor failed/cancelled requests, provider capacity and document-reader load. A capacity response does not imply a completed analysis; the user can retry and ordinary direct-data queries remain available. Do not rotate the encryption key without decrypting/re-encrypting stored provider settings under a controlled procedure.

AI history is private to the creator; source access is rechecked on reads. Users can delete conversations and unreviewed extractions. Human-reviewed extraction evidence is retained with the compliance decision. Unchanged private analyses are reusable for 15 minutes; document reuse is bound to content hash/version and fresh validation. Candidate retention removes linked personal AI content. Review retention of other AI history and backups under the organization policy.

Deployments with a proxy must allow the document extraction event stream to flush (`proxy_buffering off` for that endpoint) and permit the 90-second processing deadline. A browser disconnect cancels pending generation; no fabricated successful response is saved.
