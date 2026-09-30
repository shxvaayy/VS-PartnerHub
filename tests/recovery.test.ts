import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import Database from "better-sqlite3";
import * as tar from "tar";
import {
  createRecoveryBackup,
  createRecoveryKey,
  encryptRecoveryArchive,
  unpackRecoveryBackup,
} from "../server/recovery.js";

let directory: string, keyFile: string, sqlite: Database.Database;
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const document = Buffer.from("Private contract evidence, revision 2\n");
const logo = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const source = () => ({
  sqlitePath: path.join(directory, "source.sqlite"),
  fileStorage: "local",
  uploadDir: path.join(directory, "uploads"),
});
const options = () => ({
  source: source(),
  output: path.join(directory, "backup.vshub"),
  keyFile,
  revision: "recovery-regression-fixture",
});
beforeEach(async () => {
  directory = mkdtempSync(path.join(tmpdir(), "partnerhub-recovery-test-"));
  keyFile = path.join(directory, "recovery.key");
  await createRecoveryKey(keyFile);
  mkdirSync(source().uploadDir, { mode: 0o700 });
  writeFileSync(path.join(source().uploadDir, "contract.pdf"), document);
  writeFileSync(path.join(source().uploadDir, "logo.png"), logo);
  writeFileSync(
    path.join(source().uploadDir, "unreferenced.txt"),
    "Do not export unrelated files",
  );
  sqlite = new Database(source().sqlitePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(`
    CREATE TABLE organizations (id TEXT PRIMARY KEY, logo_key TEXT);
    CREATE TABLE documents (id TEXT PRIMARY KEY, storage_key TEXT UNIQUE, size INTEGER);
    CREATE TABLE records (id TEXT PRIMARY KEY, title TEXT);
    INSERT INTO organizations VALUES ('organization-1', 'logo.png');
    INSERT INTO records VALUES ('record-1', 'Committed WAL requirement');
  `);
  sqlite
    .prepare("INSERT INTO documents VALUES (?, ?, ?)")
    .run("document-1", "contract.pdf", document.length);
});
afterEach(() => {
  sqlite?.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("Encrypted database and private-file recovery", () => {
  it("restores committed WAL data, documents and logos with matching hashes and private permissions", async () => {
    const sourceBefore = sqlite
      .prepare("SELECT name FROM sqlite_master ORDER BY name")
      .all();
    const result = await createRecoveryBackup(options());
    expect(readFileSync(result.output).includes(document)).toBe(false);
    expect(result.manifest.files.map((file) => file.kind).sort()).toEqual([
      "document",
      "logo",
    ]);
    expect(
      result.manifest.database.tables.find((table) => table.name === "records")
        ?.rows,
    ).toBe("1");
    const destination = path.join(directory, "restored");
    await unpackRecoveryBackup({ source: result.output, keyFile, destination });
    expect(
      readFileSync(path.join(destination, "uploads", "contract.pdf")),
    ).toEqual(document);
    expect(readFileSync(path.join(destination, "uploads", "logo.png"))).toEqual(
      logo,
    );
    expect(readdirSync(path.join(destination, "uploads")).sort()).toEqual([
      "contract.pdf",
      "logo.png",
    ]);
    const restored = new Database(path.join(destination, "database.sqlite"), {
      readonly: true,
    });
    try {
      expect(
        restored
          .prepare("SELECT title FROM records WHERE id = 'record-1'")
          .get(),
      ).toEqual({ title: "Committed WAL requirement" });
      expect(restored.pragma("integrity_check", { simple: true })).toBe("ok");
    } finally {
      restored.close();
    }
    expect(
      sqlite.prepare("SELECT name FROM sqlite_master ORDER BY name").all(),
    ).toEqual(sourceBefore);
    expect(
      readdirSync(directory).some((name) =>
        name.startsWith(".partnerhub-recovery-"),
      ),
    ).toBe(false);
    if (process.platform !== "win32") {
      expect(statSync(result.output).mode & 0o077).toBe(0);
      expect(statSync(destination).mode & 0o077).toBe(0);
      expect(
        statSync(path.join(destination, "uploads", "contract.pdf")).mode &
          0o077,
      ).toBe(0);
    }
  });

  it("does not overwrite a backup, recovery key or existing restore destination", async () => {
    const result = await createRecoveryBackup(options());
    const original = sha(readFileSync(result.output));
    await expect(createRecoveryBackup(options())).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(sha(readFileSync(result.output))).toBe(original);
    const savedKey = readFileSync(keyFile);
    await expect(createRecoveryKey(keyFile)).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(readFileSync(keyFile)).toEqual(savedKey);
    const destination = path.join(directory, "existing");
    mkdirSync(destination);
    writeFileSync(path.join(destination, "keep.txt"), "Existing data");
    await expect(
      unpackRecoveryBackup({ source: result.output, keyFile, destination }),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(readFileSync(path.join(destination, "keep.txt"), "utf8")).toBe(
      "Existing data",
    );
  });

  it.each([
    "missing document",
    "missing logo",
    "wrong size",
    "unsafe reference",
  ])("fails without publishing an incomplete backup: %s", async (failure) => {
    if (failure === "missing document")
      rmSync(path.join(source().uploadDir, "contract.pdf"));
    if (failure === "missing logo")
      rmSync(path.join(source().uploadDir, "logo.png"));
    if (failure === "wrong size")
      writeFileSync(path.join(source().uploadDir, "contract.pdf"), "truncated");
    if (failure === "unsafe reference")
      sqlite.prepare("UPDATE documents SET storage_key = '../outside'").run();
    await expect(createRecoveryBackup(options())).rejects.toThrow();
    expect(existsSync(options().output)).toBe(false);
    expect(
      readdirSync(directory).some((name) =>
        name.startsWith(".partnerhub-recovery-"),
      ),
    ).toBe(false);
  });

  it.each(["wrong key", "changed ciphertext", "truncated archive"])(
    "rejects %s before extracting any files",
    async (failure) => {
      const result = await createRecoveryBackup(options());
      const broken = path.join(directory, "broken.vshub");
      let data = readFileSync(result.output);
      let selectedKey = keyFile;
      if (failure === "wrong key") {
        selectedKey = path.join(directory, "another.key");
        await createRecoveryKey(selectedKey);
      } else if (failure === "changed ciphertext")
        data[Math.floor(data.length / 2)] ^= 1;
      else data = data.subarray(0, data.length - 32);
      writeFileSync(broken, data);
      const destination = path.join(directory, "rejected");
      await expect(
        unpackRecoveryBackup({
          source: broken,
          keyFile: selectedKey,
          destination,
        }),
      ).rejects.toThrow(/authentication failed/);
      expect(existsSync(destination)).toBe(false);
    },
  );

  it("verifies the manifest after authenticating a decryptable archive", async () => {
    const result = await createRecoveryBackup(options());
    const content = path.join(directory, "content");
    await unpackRecoveryBackup({
      source: result.output,
      keyFile,
      destination: content,
    });
    writeFileSync(
      path.join(content, "uploads", "contract.pdf"),
      "Changed even though the encryption key is valid",
    );
    const archive = path.join(directory, "modified.tar.gz");
    await tar.create({ cwd: content, file: archive, gzip: true }, [
      "manifest.json",
      "database.sqlite",
      "uploads/contract.pdf",
      "uploads/logo.png",
    ]);
    const encrypted = path.join(directory, "modified.vshub");
    await encryptRecoveryArchive(archive, encrypted, keyFile);
    const destination = path.join(directory, "rejected");
    await expect(
      unpackRecoveryBackup({ source: encrypted, keyFile, destination }),
    ).rejects.toThrow(/SHA-256 integrity/);
    expect(existsSync(destination)).toBe(false);
  });

  it.each(["../escaped.txt", "/absolute.txt", "duplicate", "symlink"])(
    "rejects unsafe archive entries: %s",
    async (failure) => {
      const bytes = Buffer.from("{}");
      const entry = (name: string, type: "File" | "SymbolicLink" = "File") => {
        const header = new tar.Header({
          path: name,
          mode: 0o600,
          size: type === "File" ? bytes.length : 0,
          type,
          linkpath: type === "SymbolicLink" ? "../outside" : undefined,
        });
        header.encode();
        return Buffer.concat([
          header.block!,
          ...(type === "File" ? [bytes, Buffer.alloc(512 - bytes.length)] : []),
        ]);
      };
      const entries = [entry("manifest.json")];
      if (failure === "duplicate") entries.push(entry("manifest.json"));
      else if (failure === "symlink")
        entries.push(entry("uploads/logo.png", "SymbolicLink"));
      else entries.push(entry(failure));
      const archive = path.join(directory, "unsafe.tar.gz");
      writeFileSync(
        archive,
        gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)])),
      );
      const encrypted = path.join(directory, "unsafe.vshub");
      await encryptRecoveryArchive(archive, encrypted, keyFile);
      const destination = path.join(directory, "rejected");
      await expect(
        unpackRecoveryBackup({ source: encrypted, keyFile, destination }),
      ).rejects.toThrow(/Unsafe/);
      expect(existsSync(destination)).toBe(false);
      expect(existsSync(path.join(directory, "escaped.txt"))).toBe(false);
    },
  );

  it("enforces an unpacked size limit without leaving a partial restore", async () => {
    const result = await createRecoveryBackup(options());
    const destination = path.join(directory, "oversize");
    await expect(
      unpackRecoveryBackup({
        source: result.output,
        keyFile,
        destination,
        maxBytes: 512,
      }),
    ).rejects.toThrow(/oversized|size limit/);
    expect(existsSync(destination)).toBe(false);
  });

  it("requires owner-only recovery key permissions", async () => {
    if (process.platform === "win32") return;
    chmodSync(keyFile, 0o644);
    await expect(createRecoveryBackup(options())).rejects.toThrow(
      /Restrict the recovery key/,
    );
    expect(existsSync(options().output)).toBe(false);
  });
});

describe("Backup CLI does not mutate its source", () => {
  const cli = path.resolve("server/cli.ts");
  function run(extra: NodeJS.ProcessEnv = {}) {
    return spawnSync(
      process.execPath,
      ["--import", import.meta.resolve("tsx"), cli, "backup"],
      {
        cwd: directory,
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_ENV: "test",
          VERCEL: "0",
          DATABASE_URL: "",
          FILE_STORAGE: "local",
          SQLITE_PATH: source().sqlitePath,
          DOTENV_CONFIG_PATH: path.join(directory, "no-env-file"),
          ...extra,
        },
      },
    );
  }
  it("backs up an older schema without running migrations or creating internal accounts", () => {
    const before = sqlite
      .prepare("SELECT name FROM sqlite_master ORDER BY name")
      .all();
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(
      sqlite.prepare("SELECT name FROM sqlite_master ORDER BY name").all(),
    ).toEqual(before);
    expect(
      sqlite.prepare("SELECT count(*) AS n FROM organizations").get(),
    ).toEqual({ n: 1 });
    expect(readdirSync(path.join(directory, "backups"))).toHaveLength(1);
  });
  it("fails on a missing SQLite source instead of creating an empty application", () => {
    const missing = path.join(directory, "missing.sqlite");
    expect(run({ SQLITE_PATH: missing }).status).not.toBe(0);
    expect(existsSync(missing)).toBe(false);
  });
  it("rejects the SQLite-only command before connecting to PostgreSQL", () => {
    const result = run({
      DATABASE_URL: "postgresql://unreachable@127.0.0.1:9/untouched",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("use npm run recovery:backup");
    expect(result.stderr).not.toContain("ECONNREFUSED");
  });
});
