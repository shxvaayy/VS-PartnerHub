# Security model

## Implemented controls

- Passwords are individually salted and hashed with Node's scrypt. Authentication tokens use SHA-256 or secret-keyed HMAC; plaintext session tokens are never stored in the database.
- Sessions expire after 12 hours and use an HttpOnly, SameSite=Lax cookie. Production cookies are Secure. Password changes/resets revoke sessions and pending login/reset tokens. Changing email sign-in verification revokes other sessions and pending sign-in challenges.
- Email verification and optional sign-in codes expire after 10 minutes and permit at most five attempts. Invitation links are single-use and expire after 72 hours. Account recovery returns a generic response to avoid disclosing registration status.
- Mutations require the session's `X-CSRF-Token`; cross-origin mutations are rejected. Authentication and API routes are rate-limited outside the isolated test environment.
- Authorization checks run on every API action and document download. Roles, organization type and record relationships all apply. An external administrator cannot create VS internal users or approve their own organization.
- Workflow decisions, financial calculations, related-record eligibility and optimistic versions are checked server-side. Concurrent payment reservations and unique commercial references protect financial integrity.
- Uploaded documents are limited to 10 MB and validated as PDF, PNG or JPEG using MIME, extension and file signature checks. They use random private filenames, attachment-only downloads and no public file URLs. Role and organization checks also apply to supporting documents.
- Helmet sets a same-origin CSP, frame restrictions, no-sniff headers and production HSTS. Passwords, session secrets and authentication email contents are not returned through administration screens.
- Audit history records important mutations, downloads, exports and workflow decisions. Audit rows have no application edit/delete endpoint.

## Deployment responsibilities

This code does not encrypt disks or databases, operate TLS certificates, scan PDFs for malware, implement SAML/OIDC, provide phishing-resistant WebAuthn, perform regulatory verification or make audit storage tamper-proof against a database administrator. Configure encrypted infrastructure, restricted database credentials, private backups and log access in the deployment environment. Attach a malware scanner or upload quarantine if company policy requires it.

Email sign-in codes improve password-only login but are not phishing-resistant MFA. An enterprise identity provider/WebAuthn integration can be added for stronger authentication policy. Do not enable an account's email sign-in verification until its verified mailbox can receive production mail.

The supplied local `.example` accounts are development fixtures. Production disables fixture creation and code exposure; never point a production server at a previously seeded demo database.

## Data and retention

Collect only hiring data authorized by the candidate and required for the assigned role. Consent and retention metadata are server-managed. Closed/joined candidates and linked interview data are anonymized after the configured period; active candidates remain intact. Restrict free-text notes to information needed for the workflow.

Audit retention is a minimum policy setting. Archive audit history under the company's approved procedure; automatic deletion is intentionally absent. Database and document backups must follow the same privacy/retention policy and should be encrypted and access controlled.

See [OPERATIONS.md](docs/OPERATIONS.md) for recovery and incident handling. Report suspected vulnerabilities privately to the repository owner or the organization's designated security team; do not include personal data, credentials or session tokens in a public issue.
