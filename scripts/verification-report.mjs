import { readFile, writeFile, mkdir, cp, readdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve("artifacts/local-verification");
const output = path.join(root, "handoff");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const filenames = {
  sqlite: "backend-sqlite.json",
  postgres: "backend-postgres.json",
  browser: "browser-report.json",
  files: "files-report.json",
  live: "ai/live-complete.json",
  smtp: "auth-smtp/report.json",
  production: "production-report.json",
  accessibility: "accessibility-report.json",
  preview: "preview-report.json",
  build: "build-report.json",
  dependencies: "dependency-audit.json",
  secrets: "secrets-report.json",
};
const evidencePaths = new Map(
  Object.entries(filenames).map(([key, file]) => [
    file,
    `evidence/${key}.json`,
  ]),
);
const reports = Object.fromEntries(
  await Promise.all(
    Object.entries(filenames).map(async ([key, file]) => {
      try {
        return [key, JSON.parse(await readFile(path.join(root, file), "utf8"))];
      } catch {
        return [key, { missing: true }];
      }
    }),
  ),
);
const rows = [],
  groups = [];
const add = (group, name, passed, duration = "", evidence = "") =>
  rows.push({
    group,
    name,
    passed,
    duration,
    evidence: evidencePaths.get(evidence) || evidence,
  });
function finish(group, evidence) {
  const items = rows.filter((row) => row.group === group);
  groups.push({
    name: group,
    passed: items.filter((row) => row.passed).length,
    total: items.length,
    evidence: evidencePaths.get(evidence) || evidence,
  });
}
for (const [key, label] of [
  ["sqlite", "SQLite automated suite"],
  ["postgres", "PostgreSQL automated suite"],
]) {
  const report = reports[key];
  if (report.missing) add(label, "Report is missing", false);
  else
    for (const file of report.testResults || [])
      for (const test of file.assertionResults || [])
        add(
          label,
          test.fullName || test.title,
          test.status === "passed",
          test.duration || "",
          filenames[key],
        );
  if (!rows.some((row) => row.group === label))
    add(label, "No tests recorded", false);
  finish(label, filenames[key]);
}
function browserSuites(suites) {
  for (const suite of suites || []) {
    for (const spec of suite.specs || [])
      for (const test of spec.tests || []) {
        const last = test.results?.at(-1);
        add(
          "Browser workflows",
          spec.title,
          spec.ok && test.status === "expected" && last?.status === "passed",
          last?.duration || "",
          filenames.browser,
        );
      }
    browserSuites(suite.suites);
  }
}
browserSuites(reports.browser.suites);
if (!rows.some((row) => row.group === "Browser workflows"))
  add("Browser workflows", "Report is missing or empty", false);
finish("Browser workflows", filenames.browser);
for (const [key, label] of [
  ["files", "PDF and CSV acceptance"],
  ["live", "Live VS AI acceptance"],
  ["smtp", "Real-mode SMTP authentication"],
]) {
  for (const check of reports[key].checks || [])
    add(
      label,
      check.name || check.feature,
      check.passed === true,
      check.elapsedMs || "",
      filenames[key],
    );
  if (!rows.some((row) => row.group === label))
    add(label, "Report is missing or empty", false);
  finish(label, filenames[key]);
}
for (const check of reports.production.checks || [])
  add(
    "Production runtime and recovery",
    check,
    reports.production.passed === true,
    "",
    filenames.production,
  );
if (!rows.some((row) => row.group === "Production runtime and recovery"))
  add(
    "Production runtime and recovery",
    reports.production.error || "Report is missing",
    false,
  );
finish("Production runtime and recovery", filenames.production);
for (const check of Array.isArray(reports.accessibility)
  ? reports.accessibility
  : [])
  add(
    "Automated accessibility",
    check.page,
    check.violations.length === 0,
    "",
    filenames.accessibility,
  );
if (!rows.some((row) => row.group === "Automated accessibility"))
  add("Automated accessibility", "Report is missing", false);
finish("Automated accessibility", filenames.accessibility);
for (const check of reports.preview.routes || [])
  add(
    "Navigation and responsive layout",
    check.heading || check.route,
    check.loaded === true,
    "",
    filenames.preview,
  );
add(
  "Navigation and responsive layout",
  "No browser runtime errors",
  Array.isArray(reports.preview.errors) && reports.preview.errors.length === 0,
  "",
  filenames.preview,
);
for (const key of ["overflow", "landingOverflow"])
  add(
    "Navigation and responsive layout",
    key === "overflow" ? "Phone workspace width" : "Phone landing width",
    reports.preview[key]?.scroll <= reports.preview[key]?.width,
    "",
    filenames.preview,
  );
finish("Navigation and responsive layout", filenames.preview);
for (const check of reports.build.checks || [])
  add(
    "Build and static checks",
    check.name,
    check.exitCode === 0,
    check.elapsedMs,
    filenames.build,
  );
if (!rows.some((row) => row.group === "Build and static checks"))
  add("Build and static checks", "Report is missing", false);
add(
  "Build and static checks",
  "Dependency audit",
  reports.dependencies.metadata?.vulnerabilities?.total === 0,
  "",
  filenames.dependencies,
);
add(
  "Build and static checks",
  "Configured secret scan",
  reports.secrets.passed === true,
  "",
  filenames.secrets,
);
finish("Build and static checks", filenames.build);
const passed = rows.every((row) => row.passed),
  now = new Date();
const stamp =
  now.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "long",
    timeStyle: "short",
  }) + " IST";
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const csv = (value) => '"' + String(value ?? "").replaceAll('"', '""') + '"';
await writeFile(
  path.join(output, "verification-checklist.csv"),
  "\ufeff" +
    [
      "Suite,Check,Result,Duration (ms),Evidence",
      ...rows.map((row) =>
        [
          row.group,
          row.name,
          row.passed ? "Passed" : "Needs attention",
          row.duration,
          row.evidence,
        ]
          .map(csv)
          .join(","),
      ),
    ].join("\r\n"),
);
await mkdir(path.join(output, "evidence"), { recursive: true });
for (const [key, file] of Object.entries(filenames))
  if (!reports[key].missing)
    await cp(
      path.join(root, file),
      path.join(output, "evidence", `${key}.json`),
    );
for (const folder of ["fixtures", "exports"])
  await cp(path.join(root, folder), path.join(output, folder), {
    recursive: true,
  });
const screenshots = [
  [
    "ai-actions-desktop.png",
    "Saved assistant reply with named actions; browser regression scenario.",
  ],
  [
    "document-ai-processing-desktop.png",
    "Document processing responds to actual stage events; browser progress scenario.",
  ],
  [
    "document-ai-review-mobile.png",
    "Mobile document status and extraction stages. The full image is included in screenshots.",
  ],
  ["06-navigation-mobile.png", "Mobile workspace navigation."],
  [
    "01-landing-desktop.png",
    "Public portal entry view. The full landing-page image is included in screenshots.",
  ],
  [
    "02-admin-desktop.png",
    "Organization and business activity in the administrator workspace.",
  ],
  [
    "document-ai-next-steps.png",
    "A clear review status, original file download and document questions.",
  ],
  [
    "document-ai-verifier.png",
    "The authorized VS reviewer receives the document-review action.",
  ],
  [
    "ai-requirement-review.png",
    "Requirement fields are editable before an explicit draft save.",
  ],
  [
    "ai-commercial-comparison.png",
    "Recorded quotation values and commercial terms appear side by side.",
  ],
  [
    "ai-partner-discovery.png",
    "Readable search criteria and a link to the authorized partner profile.",
  ],
  [
    "ai-operational-alerts-mobile.png",
    "Operational explanations link to current evidence on mobile.",
  ],
];
await mkdir(path.join(output, "screenshots"), { recursive: true });
const screenshotHtml = [];
for (const [file, caption] of screenshots) {
  try {
    const bytes = await readFile(path.join(root, file));
    await writeFile(path.join(output, "screenshots", file), bytes);
    screenshotHtml.push(
      `<figure${file === "01-landing-desktop.png" ? ' class="portal-preview"' : ""}><img alt="${escape(caption)}" src="data:image/png;base64,${bytes.toString("base64")}"/><figcaption>${escape(caption)}</figcaption></figure>`,
    );
  } catch {
    screenshotHtml.push(`<p>Screenshot unavailable: ${escape(file)}</p>`);
  }
}
const liveChecks = (reports.live.checks || []).filter((check) => check.passed);
const capabilityDescriptions = [
  [
    "A",
    "Workspace assistant",
    "Live records, natural follow-ups and line items, English output, topic changes, saved-history cleanup and permitted action controls.",
  ],
  [
    "B",
    "Document intelligence",
    "Readable, scanned, mixed and 61-page PDFs; later-page fields, eight identity values, content reuse and separate human review.",
  ],
  [
    "C",
    "Requirement drafting",
    "Business and hiring briefs become editable structured drafts. Saving remains an explicit authorized operation.",
  ],
  [
    "D",
    "Quotation analysis",
    "Commercial values reconcile to stored totals, taxes, discounts and terms; analysis does not award an RFQ.",
  ],
  [
    "E",
    "Partner discovery",
    "All nine specified profile filters; private KYC excluded; a changed profile invalidates saved analysis.",
  ],
  [
    "F",
    "Operational alerts",
    "All seven signal categories, actual dates/balances, bounded statistical interpretation and no business mutations.",
  ],
];
const capabilityRows = capabilityDescriptions
  .map(([code, name, description]) => {
    const checks = (reports.live.checks || []).filter((check) =>
      check.feature?.startsWith(`${code}:`),
    );
    return `<tr><th>${code}. ${escape(name)}</th><td>${escape(description)}</td><td>${checks.filter((check) => check.passed).length}/${checks.length} live checks</td></tr>`;
  })
  .join("");
const durations = liveChecks
  .filter((check) => check.providerRequests > 0 && check.elapsedMs)
  .map((check) => check.elapsedMs)
  .sort((a, b) => a - b);
const percentile = (p) =>
  durations.length
    ? (
        durations[
          Math.min(durations.length - 1, Math.ceil(durations.length * p) - 1)
        ] / 1000
      ).toFixed(2) + " s"
    : "Not recorded";
const reused = liveChecks.filter((check) => check.providerRequests === 0);
const failures = rows.filter((row) => !row.passed);
const logo = `data:image/svg+xml;base64,${(await readFile("public/favicon.svg")).toString("base64")}`;
const style = `@page{size:A4;margin:15mm 14mm 18mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#233c31;background:#fff;margin:0;font-size:11px;line-height:1.55}main{max-width:940px;margin:auto}header{background:#193e32;color:#fff;border-radius:14px;padding:27px 30px;margin-bottom:22px}.brand{display:flex;align-items:center;gap:12px;font-size:16px;font-weight:700}.brand img{width:35px;height:35px}header p{color:#d7e8ca;margin:6px 0 0}h1{font-size:30px;line-height:1.15;margin:25px 0 8px;letter-spacing:-.7px}h2{font-size:18px;margin:24px 0 10px}h3{font-size:14px;margin:18px 0 8px}p{margin:7px 0}.status{display:inline-block;background:#e9f3df;color:#254b37;border-radius:20px;padding:5px 12px;font-weight:700}.attention{background:#fff0df;color:#7b4a1d}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:20px 0}.stat{border:1px solid #dfe6da;border-radius:10px;padding:13px}.stat strong{display:block;font-size:24px}.stat span{font-size:10px;color:#556754}table{width:100%;border-collapse:collapse;margin:12px 0;font-size:10px}th,td{text-align:left;border-bottom:1px solid #dfe6da;padding:9px 8px;vertical-align:top}thead th{background:#eef4e7}tr,figure,.stat{break-inside:avoid}a{color:#31583e}ul{padding-left:18px}.note{background:#f4f7f0;border-left:3px solid #93ad71;padding:12px 16px;margin:15px 0}.page{break-before:page}figure{margin:13px 0 24px}figure img{max-width:100%;max-height:590px;object-fit:contain;object-position:top left;border:1px solid #e0e7db;border-radius:7px}figcaption{font-size:10px;color:#596b5c;margin-top:6px}.screens{display:grid;grid-template-columns:1fr 1fr;gap:16px}.screens img{max-height:500px}.muted{color:#5c6a5e}.answer{white-space:pre-wrap;padding:14px 18px;background:#f6f8f3;border:1px solid #dfe6da;border-radius:9px}.report-end{margin-top:25px;border-top:1px solid #dfe6da;padding-top:12px;color:#596b5c}body.responses h2{break-before:auto} @media screen{body{background:#edf1e8;padding:35px}main{background:#fff;padding:35px;border-radius:20px}}`;
const previewStyle = `.screens figure img{width:100%;height:500px;object-fit:cover;object-position:top}.portal-preview img{width:100%;height:480px;object-fit:cover;object-position:top}`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>VS PartnerHub — Local verification</title><style>${style}${previewStyle}</style></head><body><main>
<header><div class="brand"><img src="${logo}" alt="VS"/>VS PartnerHub</div><h1>Local acceptance<br/>verification report</h1><p>Enterprise partner management, procurement and recruitment</p><p>Prepared ${escape(stamp)}</p></header>
<span class="status ${passed ? "" : "attention"}">${passed ? "Recorded local checks passed" : "Review required — see outstanding checks"}</span>
<p>This report is generated from the actual automated results and live AI responses in the accompanying evidence folder. Tests use isolated QA organizations, files and transactions. They do not certify a production deployment or external inbox delivery.</p>
<div class="stats"><div class="stat"><strong>${reports.sqlite.numPassedTests ?? "—"}</strong><span>SQLite checks passed</span></div><div class="stat"><strong>${reports.postgres.numPassedTests ?? "—"}</strong><span>PostgreSQL checks passed</span></div><div class="stat"><strong>${groups.find((group) => group.name === "Browser workflows")?.passed ?? "—"}</strong><span>Browser workflows passed</span></div><div class="stat"><strong>${liveChecks.length}</strong><span>Live AI checks passed</span></div></div>
<h2>Recorded results</h2><table><thead><tr><th>Verification area</th><th>Result</th><th>Evidence</th></tr></thead><tbody>${groups.map((group) => `<tr><td>${escape(group.name)}</td><td>${group.passed}/${group.total} passed</td><td><a href="${escape(group.evidence)}">${escape(group.evidence)}</a></td></tr>`).join("")}</tbody></table>
${failures.length ? `<div class="note"><strong>Checks requiring attention</strong><ul>${failures.map((row) => `<li>${escape(row.group)}: ${escape(row.name)}</li>`).join("")}</ul></div>` : ""}
<h2 class="page">VS AI — all six roadmap capabilities</h2><table><thead><tr><th>Capability</th><th>Verified behavior</th><th>Live result</th></tr></thead><tbody>${capabilityRows}</tbody></table>
<p>Additional API and browser cases verify tenant restrictions, changed permissions, cancellation, malformed provider output, source validation, saved history, retries, accessibility and the separation of extraction from human approval.</p>
<p>API and browser suites use controlled provider responses to reproduce success and failure states. The separate live suite exercises the configured Google service for real language responses and OCR, alongside checks for reuse and human decision ownership. The evidence labels these different checks explicitly.</p>
<div class="note"><strong>Measured live task response time:</strong> median ${percentile(0.5)}; 95th percentile ${percentile(0.95)}. ${reused.length} successful cases required no provider call. These local measurements exclude the acceptance runner's deliberate rate-limit pacing and are not a production response-time guarantee.</div>
<h3>Application code and AI each have a defined role</h3><p>Code performs authorization, database filters, counts, commercial calculations, PDF text preparation, field validation, date/statistical alerts, cache invalidation and workflow decisions. AI handles language interpretation, image OCR and explanations. Repeated unchanged analyses can reuse the same user's prior result; source access is always checked again.</p>
<h3>Important regressions resolved</h3><ul><li>Internal routes in assistant replies and saved chats are replaced with readable text and authorized named controls.</li><li>Natural follow-ups retrieve the requested record and its current line items; unrelated topics do not repeat previous business reports.</li><li>Document processing shows real stage events and leaves human review/approval pending.</li><li>Compact citation references keep larger alert analyses within the provider's response-schema limits.</li></ul>
<h2>Scope of the business checks</h2><p>The automated workflows cover onboarding and verification; role-specific workspaces; RFQ, quotation, PO, delivery, invoice and payment progression; contracts and signing evidence; recruitment through joining; staffing, services and technology operations; support, notifications, imports, reports and authorization.</p>
<h2 class="page">Files, authentication and deployment boundary</h2><p>Generated PDF, scanned PDF, PNG and CSV fixtures are included. Upload/download hashes are compared; invalid or oversized files are rejected; CSV previews do not write records; import commits are atomic and replay-safe. Exported management totals reconcile to stored data, and spreadsheet formula values are neutralized.</p>
<p>Real-mode registration, email OTP, login verification and password recovery run through an authenticated SMTP receiver on loopback. Security codes are read by the test mailbox, not exposed in the product interface. The SMTP evidence records ${reports.smtp.messagesReceived ?? "—"} received messages and ${reports.smtp.smtpAuthentications ?? "—"} authenticated deliveries/connections.</p>
<div class="note"><strong>Before a production client rollout:</strong><ul><li>Connect the authorized production email sender and confirm delivery to the intended external mailboxes. This run did not send external email.</li><li>Configure hosting/TLS, private storage, off-site backups, monitoring and the deployment's Google project capacity. Burst testing observed a provider rate limit; the app returns an honest retry state.</li><li>Payment settlement, statutory verification, qualified digital signatures and provider-specific ERP/BGV connections need their selected services. Recorded references and human decisions are not a bank or government verification.</li><li>Android/iOS projects and web layouts are present; native SDK builds, signing and physical-device distribution were not verified on this machine. Automated accessibility does not replace manual assistive-technology review.</li></ul></div>
<h3>How to review the evidence</h3><ol><li>Open <strong>verification-checklist.csv</strong> for every named result.</li><li>Read <strong>live-ai-responses.html</strong> for the actual prompts and returned narratives.</li><li>Inspect <strong>fixtures</strong>, <strong>exports</strong>, <strong>screenshots</strong> and the original JSON files in <strong>evidence</strong>.</li><li>Use <strong>manifest.json</strong> to check the SHA-256 of each supplied artifact.</li></ol>
<p class="muted">Environment: local macOS, Node ${escape(process.version)}, SQLite, an isolated PostgreSQL cluster and Chrome. Test data is explicitly fictional and kept apart from the working user database.</p>
<h2 class="page">Workspace assistant</h2>${screenshotHtml[0] || ""}
<h2 class="page">Document processing</h2>${screenshotHtml[1] || ""}
<h2 class="page">Mobile review and navigation</h2><div class="screens">${screenshotHtml[2] || ""}${screenshotHtml[3] || ""}</div>
<h2 class="page">Public portal</h2>${screenshotHtml[4] || ""}
<h2 class="page">Administrator workspace</h2>${screenshotHtml[5] || ""}
<h2 class="page">Clear document actions</h2>${screenshotHtml[6] || ""}<h3>Requirement drafts remain editable</h3>${screenshotHtml[8] || ""}
<p class="report-end">VS PartnerHub • Vijay Software Solutions Pvt. Ltd. • Local verification evidence</p></main></body></html>`;
await writeFile(path.join(output, "verification-report.html"), html);
const answers = (reports.live.checks || [])
  .map(
    (check) =>
      `<section><h2>${escape(check.feature)}</h2><p class="muted">${check.passed ? "Passed" : "Needs attention"}${check.elapsedMs ? ` · ${check.elapsedMs} ms` : ""}${check.providerRequests !== undefined ? ` · ${check.providerRequests} provider request(s)` : ""}</p>${check.input ? `<h3>Input</h3><pre class="answer">${escape(JSON.stringify(check.input, null, 2))}</pre>` : ""}${check.output ? `<h3>Actual response</h3><div class="answer">${escape(check.output.answer || check.output.result?.summary || JSON.stringify(check.output, null, 2))}</div>` : ""}${check.error ? `<p>${escape(check.error)}</p>` : ""}</section>`,
  )
  .join("");
await writeFile(
  path.join(output, "live-ai-responses.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>VS AI — actual acceptance responses</title><style>${style}</style></head><body class="responses"><main><h1>VS AI: actual acceptance responses</h1><p>Generated ${escape(stamp)} from ${escape(filenames.live)}. All records and files are isolated QA fixtures. Full structured extraction, comparison and source evidence is retained in evidence/live.json.</p>${answers}</main></body></html>`,
);
await writeFile(
  path.join(output, "summary.json"),
  JSON.stringify(
    {
      generatedAt: now.toISOString(),
      passed,
      groups,
      environment: { node: process.version, platform: process.platform },
      limitations: [
        "No external inbox delivery",
        "No hosted production deployment or off-site recovery drill",
        "No statutory or bank settlement integration",
        "No signed native SDK builds",
        "Provider project rate limits apply",
      ],
    },
    null,
    2,
  ),
);
const browser = await chromium.launch({
  channel: process.env.CI ? undefined : "chrome",
});
try {
  const page = await browser.newPage();
  await page.goto(
    pathToFileURL(path.join(output, "verification-report.html")).href,
    { waitUntil: "networkidle" },
  );
  await page.pdf({
    path: path.join(output, "VS-PartnerHub-Verification-Report.pdf"),
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate:
      '<div style="font-family:Arial;font-size:9px;color:#66745e;width:100%;padding:0 16mm;display:flex;justify-content:space-between"><span>VS PartnerHub · Local verification</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
    preferCSSPageSize: true,
  });
} finally {
  await browser.close();
}
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? files(path.join(directory, entry.name))
          : [path.join(directory, entry.name)],
      ),
    )
  ).flat();
}
const manifest = await Promise.all(
  (await files(output))
    .filter((file) => path.basename(file) !== "manifest.json")
    .sort()
    .map(async (file) => {
      const bytes = await readFile(file);
      return {
        file: path.relative(output, file),
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    }),
);
await writeFile(
  path.join(output, "manifest.json"),
  JSON.stringify({ generatedAt: now.toISOString(), files: manifest }, null, 2),
);
const archive = path.join(root, "VS-PartnerHub-Verification.zip");
await rm(archive, { force: true });
const zip = spawnSync("zip", ["-q", "-r", archive, path.basename(output)], {
  cwd: root,
  encoding: "utf8",
});
if (zip.status !== 0)
  throw new Error(
    zip.stderr || "Could not package the verification artifacts.",
  );
console.log(
  JSON.stringify(
    {
      passed,
      checklistRows: rows.length,
      groups,
      report: path.join(output, "VS-PartnerHub-Verification-Report.pdf"),
      archive,
    },
    null,
    2,
  ),
);
if (!passed) process.exitCode = 1;
