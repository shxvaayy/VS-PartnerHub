import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";
import { unzipSync, strFromU8 } from "fflate";

const out = path.resolve("artifacts/android-release");
await fs.mkdir(out, { recursive: true });
const checks = [],
  artifacts = [];
const run = (command, args) =>
  execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
const metadata = JSON.parse(
  await fs.readFile("android/release-signing.json", "utf8"),
);
const origin = new URL(process.env.MOBILE_SERVER_URL || "");
const report = {
  commit: run("git", ["rev-parse", "HEAD"]).trim(),
  startedAt: new Date().toISOString(),
  signingIdentity: metadata.certificateSha256,
  applicationId: metadata.applicationId,
  versionCode: Number(process.env.PARTNERHUB_ANDROID_VERSION_CODE),
  versionName: process.env.PARTNERHUB_ANDROID_VERSION_NAME,
  checks,
  artifacts,
  companyStorePublication: false,
  physicalDeviceTested: false,
};
try {
  assert.equal(origin.protocol, "https:");
  assert(
    !origin.username && !origin.password && !origin.search && !origin.hash,
  );
  assert.equal(origin.pathname, "/");
  const apk = path.resolve(
    "android/app/build/outputs/apk/release/app-release.apk",
  );
  const aab = path.resolve(
    "android/app/build/outputs/bundle/release/app-release.aab",
  );
  const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
  assert(sdk, "The Android SDK is required.");
  const buildTools = path.join(sdk, "build-tools/36.0.0");
  const inspection = run(path.join(buildTools, "aapt"), [
    "dump",
    "badging",
    apk,
  ]);
  assert(inspection.includes(`name='${metadata.applicationId}'`));
  assert(inspection.includes(`versionCode='${report.versionCode}'`));
  assert(inspection.includes(`versionName='${report.versionName}'`));
  assert.match(inspection, /sdkVersion:'24'/);
  assert.match(inspection, /targetSdkVersion:'36'/);
  assert(!inspection.includes("application-debuggable"));
  checks.push({
    name: "Release identity, version and non-debuggable manifest",
    passed: true,
  });
  const signatures = run(path.join(buildTools, "apksigner"), [
    "verify",
    "--verbose",
    "--print-certs",
    apk,
  ]);
  const apkCertificate = signatures
    .match(/Signer #1 certificate SHA-256 digest:\s*([a-f0-9]+)/i)?.[1]
    .toLowerCase();
  assert.equal(apkCertificate, metadata.certificateSha256);
  assert.match(signatures, /Verified using v2 scheme.*true/);
  checks.push({
    name: "APK signature matches the retained project release identity",
    passed: true,
  });
  const verifiedBundle = run("jarsigner", ["-verify", aab]);
  assert.match(verifiedBundle, /jar verified/i);
  const certificate = new X509Certificate(
    run("keytool", ["-printcert", "-jarfile", aab, "-rfc"]),
  );
  assert.equal(
    certificate.fingerprint256.replaceAll(":", "").toLowerCase(),
    metadata.certificateSha256,
  );
  checks.push({
    name: "AAB signature uses the same release certificate",
    passed: true,
  });
  for (const [file, prefix, filename] of [
    [apk, "", "VS-PartnerHub-Android.apk"],
    [aab, "base/", "VS-PartnerHub-Android.aab"],
  ]) {
    const bytes = await fs.readFile(file);
    const files = unzipSync(bytes, {
      filter: (entry) =>
        /(?:capacitor.config.json|public\/offline.html)$/.test(entry.name),
    });
    const config = JSON.parse(
      strFromU8(files[prefix + "assets/capacitor.config.json"]),
    );
    assert.equal(config.appId, metadata.applicationId);
    assert.equal(config.server.url, `${origin.origin}/app`);
    assert.equal(config.server.cleartext, false);
    assert.equal(config.android.allowMixedContent, false);
    const offline = strFromU8(files[prefix + "assets/public/offline.html"]);
    assert(offline.includes(`${origin.origin}/app`));
    assert.match(offline, /data-workspace-logo\s+src="data:image\/png;base64,/);
    await fs.copyFile(file, path.join(out, filename));
    artifacts.push({
      filename,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  checks.push({
    name: "Signed packages retain production HTTPS and bundled reconnect page",
    passed: true,
  });
  await fs.writeFile(path.join(out, "signature-inspection.txt"), signatures);
  await fs.copyFile(
    "android/release-signing.json",
    path.join(out, "release-signing.json"),
  );
} catch (error) {
  checks.push({
    name: "Signed Android release verification",
    passed: false,
    error: error.message,
  });
  process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  report.passed = checks.length === 4 && checks.every((check) => check.passed);
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: report.passed,
      checks: checks.length,
      artifacts: artifacts.map((a) => a.filename),
    }),
  );
}
