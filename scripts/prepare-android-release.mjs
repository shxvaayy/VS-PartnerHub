import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

assert(process.env.RUNNER_TEMP, "Use an isolated release runner.");
assert(
  process.env.PARTNERHUB_ANDROID_KEYSTORE &&
    process.env.PARTNERHUB_ANDROID_STORE_PASSWORD &&
    process.env.PARTNERHUB_ANDROID_SIGNING_ESCROW,
  "Configure the project signing secrets before creating an Android release.",
);
const directory = path.resolve("artifacts/android-release");
await fs.mkdir(directory, { recursive: true });
await fs.writeFile(
  path.join(process.env.RUNNER_TEMP, "partnerhub-release.p12"),
  Buffer.from(process.env.PARTNERHUB_ANDROID_KEYSTORE, "base64"),
  { flag: "wx", mode: 0o600 },
);
const escrow = Buffer.from(
  process.env.PARTNERHUB_ANDROID_SIGNING_ESCROW,
  "base64",
);
assert.equal(
  JSON.parse(escrow.toString("utf8")).format,
  "VS PartnerHub Android signing backup v1",
);
await fs.writeFile(path.join(directory, "signing-backup.json.enc"), escrow);
console.log("Release signing is prepared; only encrypted escrow is retained.");
