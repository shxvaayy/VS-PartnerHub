import assert from "node:assert/strict";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function jsonRequest(url, headers = {}) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", ...headers },
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(
    response.status,
    200,
    "The operational probe did not return HTTP 200.",
  );
  return { response, data: await response.json() };
}

export async function deploymentHealth(appUrl) {
  const address = new URL(appUrl);
  assert(
    address.protocol === "https:" && !address.username && !address.password,
    "The monitored application must have a credential-free HTTPS address.",
  );
  const { data, response } = await jsonRequest(new URL("/api/health", address));
  assert.equal(data.status, "ok", "The application database probe failed.");
  assert.equal(
    data.service,
    "VS PartnerHub",
    "The monitored service is not PartnerHub.",
  );
  assert.match(
    data.revision || "",
    /^[a-f0-9]{40}$/i,
    "The live release revision is unavailable.",
  );
  assert.match(
    response.headers.get("cache-control") || "",
    /no-store/i,
    "The health result must not be cached.",
  );
  assert(
    response.headers.get("strict-transport-security"),
    "The HTTPS transport policy is missing.",
  );
  return {
    url: address.origin,
    revision: data.revision,
    databaseReachable: true,
  };
}

export function newestVerifiedBackup(
  artifacts,
  now = Date.now(),
  maximumHours = 36,
) {
  const backups = artifacts
    .filter(
      (item) =>
        /^partnerhub-recovery-\d+-\d+$/.test(item.name) &&
        !item.expired &&
        item.size_in_bytes > 0 &&
        Date.parse(item.expires_at) > now &&
        Number.isFinite(Date.parse(item.created_at)),
    )
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  assert(backups.length, "No retained verified off-site backup is available.");
  const latest = backups[0];
  const ageHours = (now - Date.parse(latest.created_at)) / 3600000;
  assert(
    ageHours >= -0.1 && ageHours <= maximumHours,
    "The latest verified off-site backup is overdue.",
  );
  return {
    artifactId: latest.id,
    name: latest.name,
    createdAt: latest.created_at,
    expiresAt: latest.expires_at,
    ageHours: Math.round(ageHours * 100) / 100,
    maximumHours,
  };
}

export async function backupFreshness(repository, token, maximumHours = 36) {
  assert.match(
    repository || "",
    /^[\w.-]+\/[\w.-]+$/,
    "Set the monitored GitHub repository.",
  );
  assert(token, "A repository-scoped Actions read token is required.");
  const artifacts = [];
  for (let page = 1; page <= 10; page++) {
    const { data } = await jsonRequest(
      `https://api.github.com/repos/${repository}/actions/artifacts?per_page=100&page=${page}`,
      {
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    );
    artifacts.push(...data.artifacts);
    if (
      data.artifacts.some(
        (item) =>
          /^partnerhub-recovery-\d+-\d+$/.test(item.name) && !item.expired,
      ) ||
      data.artifacts.length < 100
    )
      break;
  }
  return newestVerifiedBackup(artifacts, Date.now(), maximumHours);
}

async function main() {
  const startedAt = new Date().toISOString();
  let stage = "application health";
  try {
    const application = await deploymentHealth(process.env.PARTNERHUB_APP_URL);
    stage = "backup freshness";
    const backup = await backupFreshness(
      process.env.GITHUB_REPOSITORY,
      process.env.GITHUB_TOKEN,
    );
    const result = {
      startedAt,
      checkedAt: new Date().toISOString(),
      passed: true,
      application,
      backup,
    };
    await mkdir("artifacts/operations", { recursive: true });
    await writeFile(
      "artifacts/operations/health.json",
      JSON.stringify(result, null, 2) + "\n",
    );
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        `## PartnerHub operations\n\nHTTPS and the application database are healthy. Live revision: \`${application.revision}\`.\n\nThe latest verified encrypted backup is ${backup.ageHours} hours old; freshness limit: ${backup.maximumHours} hours. Artifact: \`${backup.name}\`, retained until ${backup.expiresAt}.\n`,
      );
    console.log(JSON.stringify(result, null, 2));
  } catch {
    // Raw network/driver errors can contain source addresses or credentials.
    console.error(
      `PartnerHub ${stage} check failed. Review the live health endpoint and the most recent recovery run.`,
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
