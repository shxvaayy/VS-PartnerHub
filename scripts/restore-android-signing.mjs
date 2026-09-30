import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createDecipheriv, hkdfSync } from "node:crypto";

const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
assert(
  args.includes("--input") &&
    args.includes("--key") &&
    args.includes("--output"),
  "Use --input encrypted-backup --key recovery-key-file --output new-private-directory.",
);
const envelope = JSON.parse(await fs.readFile(value("--input"), "utf8"));
const context = Buffer.from("VS PartnerHub Android signing backup v1");
assert.equal(envelope.format, context.toString());
const keyFile = value("--key");
const stat = await fs.stat(keyFile);
assert(stat.isFile() && stat.size <= 128);
if (process.platform !== "win32")
  assert.equal(stat.mode & 0o077, 0, "Restrict the recovery key to its owner.");
const key = Buffer.from((await fs.readFile(keyFile, "utf8")).trim(), "hex");
assert.equal(key.length, 32);
const derived = Buffer.from(
  hkdfSync("sha256", key, Buffer.from(envelope.salt, "base64"), context, 32),
);
const decipher = createDecipheriv(
  "aes-256-gcm",
  derived,
  Buffer.from(envelope.iv, "base64"),
);
decipher.setAAD(context);
decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
const plaintext = Buffer.concat([
  decipher.update(Buffer.from(envelope.ciphertext, "base64")),
  decipher.final(),
]);
key.fill(0);
derived.fill(0);
const restored = JSON.parse(plaintext.toString("utf8"));
plaintext.fill(0);
assert.equal(restored.alias, "partnerhub-release");
assert.match(restored.metadata.certificateSha256, /^[a-f0-9]{64}$/);
assert(restored.password.length >= 32);
const output = path.resolve(value("--output"));
await fs.mkdir(output, { mode: 0o700 });
await fs.writeFile(
  path.join(output, "partnerhub-release.p12"),
  Buffer.from(restored.keystore, "base64"),
  { flag: "wx", mode: 0o600 },
);
await fs.writeFile(
  path.join(output, "keystore-password"),
  restored.password + "\n",
  { flag: "wx", mode: 0o600 },
);
await fs.writeFile(
  path.join(output, "release-signing.json"),
  JSON.stringify(restored.metadata, null, 2) + "\n",
  { flag: "wx", mode: 0o600 },
);
console.log(
  JSON.stringify({
    restored: true,
    output,
    certificateSha256: restored.metadata.certificateSha256,
  }),
);
