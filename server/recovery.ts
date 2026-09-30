import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import {
  appendFile,
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import Database from "better-sqlite3";
import { Client } from "pg";
import { get } from "@vercel/blob";
import * as tar from "tar";
import { z } from "zod";

// Recovery must never import db.ts, run migrations, or initialize workers.
const magic = Buffer.from("VSPH-BACKUP-1\n", "ascii");
const ivBytes = 12;
const tagBytes = 16;
const maxDocumentBytes = 10 * 1024 * 1024;
const maxManifestBytes = 32 * 1024 * 1024;
const defaultMaxBytes = 20 * 1024 ** 3;
const keySchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,99}$/i)
  .refine((value) => !value.includes(".."));
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const fileSchema = z.object({
  size: z.number().int().nonnegative().safe(),
  sha256: hashSchema,
});
const manifestSchema = z.object({
  version: z.literal(1),
  startedAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  revision: z.string().min(1).max(100),
  sourceStorage: z.enum(["local", "blob"]),
  database: fileSchema.extend({
    engine: z.enum(["sqlite", "postgres"]),
    file: z.enum(["database.sqlite", "database.dump"]),
    version: z.string(),
    schema: z.literal("public"),
    tables: z.array(
      z.object({ name: z.string().min(1), rows: z.string().regex(/^\d+$/) }),
    ),
  }),
  files: z.array(
    fileSchema.extend({
      key: keySchema,
      kind: z.enum(["document", "logo"]),
    }),
  ),
});
export type RecoveryManifest = z.infer<typeof manifestSchema>;
type Reference = {
  key: string;
  kind: "document" | "logo";
  size: number | null;
};
export type RecoverySource = {
  databaseUrl?: string;
  databaseSsl?: boolean;
  sqlitePath: string;
  fileStorage: string;
  uploadDir: string;
  blobToken?: string;
};

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

async function privateStage(parent: string) {
  const directory = await mkdtemp(path.join(parent, ".partnerhub-recovery-"));
  await chmod(directory, 0o700);
  return directory;
}

export async function createRecoveryKey(filename: string) {
  await writeFile(filename, randomBytes(32).toString("hex") + "\n", {
    flag: "wx",
    mode: 0o600,
  });
}

async function readKey(filename: string) {
  const info = await lstat(filename);
  check(info.isFile() && info.size <= 128, "Use a regular recovery key file.");
  check(
    process.platform === "win32" || (info.mode & 0o077) === 0,
    "Restrict the recovery key file to its owner (chmod 600).",
  );
  const value = (await readFile(filename, "utf8")).trim();
  check(
    /^[a-f0-9]{64}$/i.test(value),
    "Use a 32-byte hexadecimal recovery key.",
  );
  return Buffer.from(value, "hex");
}

async function digest(filename: string) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(filename)) {
    size += chunk.length;
    hash.update(chunk);
  }
  return { size, sha256: hash.digest("hex") };
}

// SQLite's online backup API includes committed WAL transactions. Opening the
// source read-only prevents this command from creating or migrating a database.
export async function createSqliteSnapshot(source: string, target: string) {
  check(
    path.resolve(source) !== path.resolve(target),
    "Choose a new backup path.",
  );
  const sourceInfo = await lstat(source);
  check(sourceInfo.isFile(), "The source database must be a regular file.");
  const reservation = await open(target, "wx", 0o600);
  await reservation.close();
  let sqlite: Database.Database | undefined;
  try {
    sqlite = new Database(source, { readonly: true, fileMustExist: true });
    await sqlite.backup(target);
    const snapshot = new Database(target, { fileMustExist: true });
    try {
      // Only normalize the copy. It must be self-contained when restored without
      // SQLite creating WAL/shared-memory sidecars next to the archive payload.
      snapshot.pragma("journal_mode = DELETE");
      check(
        snapshot.pragma("integrity_check", { simple: true }) === "ok",
        "SQLite snapshot failed its integrity check.",
      );
    } finally {
      snapshot.close();
    }
    await chmod(target, 0o600);
  } catch (error) {
    await rm(target, { force: true });
    throw error;
  } finally {
    sqlite?.close();
  }
}

function references(documents: any[], organizations: any[]): Reference[] {
  const refs: Reference[] = [
    ...documents.map((row) => ({
      key: keySchema.parse(row.storage_key),
      kind: "document" as const,
      size: Number(row.size),
    })),
    ...organizations
      .filter((row) => row.logo_key)
      .map((row) => ({
        key: keySchema.parse(row.logo_key),
        kind: "logo" as const,
        size: null,
      })),
  ];
  const unique = new Set<string>();
  for (const ref of refs) {
    check(
      !unique.has(ref.key.toLowerCase()),
      "Duplicate private file reference.",
    );
    unique.add(ref.key.toLowerCase());
    if (ref.size !== null)
      check(
        Number.isSafeInteger(ref.size) &&
          ref.size >= 0 &&
          ref.size <= maxDocumentBytes,
        "Invalid document size in the database.",
      );
  }
  return refs;
}

async function sqliteSnapshot(source: string, target: string) {
  await createSqliteSnapshot(source, target);
  const snapshot = new Database(target, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const names = snapshot
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[];
    check(
      names.some((row) => row.name === "documents") &&
        names.some((row) => row.name === "organizations"),
      "The source is not a PartnerHub database.",
    );
    const tables = names.map(({ name }) => ({
      name,
      rows: String(
        (
          snapshot
            .prepare(`SELECT count(*) AS n FROM ${quote(name)}`)
            .get() as any
        ).n,
      ),
    }));
    const documents = snapshot
      .prepare("SELECT storage_key, size FROM documents")
      .all();
    const hasLogo = (
      snapshot.pragma("table_info(organizations)") as any[]
    ).some((column) => column.name === "logo_key");
    const logos = hasLogo
      ? snapshot
          .prepare(
            "SELECT logo_key FROM organizations WHERE logo_key IS NOT NULL",
          )
          .all()
      : [];
    return {
      tables,
      refs: references(documents, logos),
      version: String(
        (snapshot.prepare("SELECT sqlite_version() AS version").get() as any)
          .version,
      ),
    };
  } finally {
    snapshot.close();
  }
}

function runDump(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    // A tool error can contain connection details. Do not print its raw output.
    child.stderr.resume();
    child.once("error", () =>
      reject(
        new Error(
          "Could not start pg_dump. Install PostgreSQL client tools and set PG_BIN if needed.",
        ),
      ),
    );
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `pg_dump failed (exit ${code}); no backup was published. Check client/server versions and read access.`,
            ),
          ),
    );
  });
}

async function postgresSnapshot(
  source: RecoverySource,
  target: string,
  pgBin?: string,
) {
  const url = new URL(source.databaseUrl!);
  check(
    ["postgres:", "postgresql:"].includes(url.protocol),
    "Use a PostgreSQL source URL.",
  );
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const ssl = source.databaseSsl || !local;
  url.searchParams.set("sslmode", ssl ? "verify-full" : "disable");
  url.searchParams.delete("uselibpqcompat");
  const client = new Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 20000,
  });
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const {
      rows: [snapshot],
    } = await client.query(
      "SELECT pg_export_snapshot() AS id, current_setting('server_version') AS version",
    );
    const { rows: names } = await client.query(
      "SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    check(
      names.some((row) => row.name === "documents") &&
        names.some((row) => row.name === "organizations"),
      "The source is not a PartnerHub database.",
    );
    const tables: { name: string; rows: string }[] = [];
    for (const { name } of names) {
      const {
        rows: [count],
      } = await client.query(
        `SELECT count(*)::text AS n FROM public.${quote(name)}`,
      );
      tables.push({ name, rows: count.n });
    }
    const { rows: documents } = await client.query(
      "SELECT storage_key, size FROM public.documents",
    );
    const { rows: columns } = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'logo_key'",
    );
    const logos = columns.length
      ? (
          await client.query(
            "SELECT logo_key FROM public.organizations WHERE logo_key IS NOT NULL",
          )
        ).rows
      : [];
    const refs = references(documents, logos);
    // Pass credentials through the child's environment, never process arguments.
    // Do not inherit PGOPTIONS/PGSERVICE or unrelated application secrets.
    await runDump(
      pgBin ? path.join(pgBin, "pg_dump") : "pg_dump",
      [
        "--format=custom",
        "--schema=public",
        "--no-owner",
        "--no-privileges",
        `--snapshot=${snapshot.id}`,
        `--file=${target}`,
      ],
      {
        PATH: process.env.PATH,
        LANG: "C",
        PGHOST: url.hostname.replace(/^\[|\]$/g, ""),
        PGPORT: url.port || "5432",
        PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
        PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password),
        PGCONNECT_TIMEOUT: "20",
        PGSSLMODE: ssl ? "verify-full" : "disable",
        ...(ssl
          ? {
              PGSSLROOTCERT:
                url.searchParams.get("sslrootcert") ||
                process.env.PGSSLROOTCERT ||
                "system",
            }
          : {}),
      },
    );
    await chmod(target, 0o600);
    await client.query("COMMIT");
    return { tables, refs, version: snapshot.version };
  } finally {
    await client.end().catch(() => {});
  }
}

async function copyPrivateFile(
  source: RecoverySource,
  ref: Reference,
  target: string,
) {
  let stream: Readable;
  const limit = ref.kind === "logo" ? 2 * 1024 * 1024 : maxDocumentBytes;
  if (source.fileStorage === "blob") {
    const object = await get(ref.key, {
      access: "private",
      token: source.blobToken,
      useCache: false,
    });
    check(
      object?.statusCode === 200,
      "A referenced private file is unavailable; backup stopped.",
    );
    stream = Readable.fromWeb(object.stream as any);
  } else {
    const filename = path.join(source.uploadDir, ref.key);
    check(
      (await lstat(filename)).isFile(),
      "A referenced private file is missing or is not a regular file.",
    );
    stream = createReadStream(filename);
  }
  const hash = createHash("sha256");
  let size = 0;
  const validate = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > limit)
        return callback(
          new Error("A private file exceeds its permitted size."),
        );
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(
    stream,
    validate,
    createWriteStream(target, { flags: "wx", mode: 0o600 }),
  );
  check(
    ref.size === null || size === ref.size,
    "Private file size differs from its database record; backup stopped.",
  );
  return { key: ref.key, kind: ref.kind, size, sha256: hash.digest("hex") };
}

export async function encryptRecoveryArchive(
  source: string,
  target: string,
  keyFile: string,
) {
  const key = await readKey(keyFile);
  try {
    const header = Buffer.concat([magic, randomBytes(ivBytes)]);
    const cipher = createCipheriv(
      "aes-256-gcm",
      key,
      header.subarray(magic.length),
    );
    cipher.setAAD(header);
    const output = createWriteStream(target, { flags: "wx", mode: 0o600 });
    output.write(header);
    await pipeline(createReadStream(source), cipher, output);
    await appendFile(target, cipher.getAuthTag());
    const handle = await open(target, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } finally {
    key.fill(0);
  }
}

async function decryptArchive(source: string, target: string, keyFile: string) {
  const key = await readKey(keyFile);
  try {
    const handle = await open(source, "r");
    let size: number, header: Buffer, tag: Buffer;
    try {
      const info = await handle.stat();
      size = info.size;
      check(
        info.isFile() && size > magic.length + ivBytes + tagBytes,
        "Invalid encrypted backup.",
      );
      header = Buffer.alloc(magic.length + ivBytes);
      tag = Buffer.alloc(tagBytes);
      await handle.read(header, 0, header.length, 0);
      await handle.read(tag, 0, tag.length, size - tagBytes);
      check(
        header.subarray(0, magic.length).equals(magic),
        "Unsupported backup format.",
      );
    } finally {
      await handle.close();
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      header.subarray(magic.length),
    );
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    try {
      await pipeline(
        createReadStream(source, {
          start: header.length,
          end: size - tagBytes - 1,
        }),
        decipher,
        createWriteStream(target, { flags: "wx", mode: 0o600 }),
      );
    } catch {
      throw new Error(
        "Backup authentication failed. Check the recovery key and archive integrity.",
      );
    }
    // No archive entry is inspected or extracted until GCM authentication passes.
  } finally {
    key.fill(0);
  }
}

export async function createRecoveryBackup(options: {
  source: RecoverySource;
  output: string;
  keyFile: string;
  revision: string;
  pgBin?: string;
}) {
  const startedAt = new Date().toISOString();
  const output = path.resolve(options.output);
  const parent = path.dirname(output);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  (await readKey(options.keyFile)).fill(0);
  check(
    ["local", "blob"].includes(options.source.fileStorage),
    "Unsupported file storage.",
  );
  if (options.source.fileStorage === "blob")
    check(options.source.blobToken, "Private Blob credentials are required.");
  const stage = await privateStage(parent);
  try {
    const content = path.join(stage, "content");
    await mkdir(path.join(content, "uploads"), {
      recursive: true,
      mode: 0o700,
    });
    const engine = options.source.databaseUrl ? "postgres" : "sqlite";
    const file = engine === "postgres" ? "database.dump" : "database.sqlite";
    const databaseFile = path.join(content, file);
    const snapshot =
      engine === "postgres"
        ? await postgresSnapshot(options.source, databaseFile, options.pgBin)
        : await sqliteSnapshot(options.source.sqlitePath, databaseFile);
    const files: RecoveryManifest["files"] = [];
    check(
      snapshot.refs.length <= 99998,
      "This backup format supports up to 99,998 private files per archive.",
    );
    // Bound memory and private-storage traffic by copying one immutable object at a time.
    for (const ref of snapshot.refs)
      files.push(
        await copyPrivateFile(
          options.source,
          ref,
          path.join(content, "uploads", ref.key),
        ),
      );
    const manifest = manifestSchema.parse({
      version: 1,
      startedAt,
      createdAt: new Date().toISOString(),
      revision: options.revision,
      sourceStorage: options.source.fileStorage,
      database: {
        engine,
        file,
        version: snapshot.version,
        schema: "public",
        tables: snapshot.tables,
        ...(await digest(databaseFile)),
      },
      files,
    });
    const manifestJson = JSON.stringify(manifest, null, 2) + "\n";
    check(
      Buffer.byteLength(manifestJson) <= maxManifestBytes,
      "The recovery manifest exceeds the format's size limit.",
    );
    await writeFile(path.join(content, "manifest.json"), manifestJson, {
      mode: 0o600,
    });
    const archive = path.join(stage, "backup.tar.gz");
    await tar.create(
      {
        cwd: content,
        file: archive,
        gzip: true,
        portable: true,
        noMtime: true,
        strict: true,
      },
      ["manifest.json", file, ...files.map((item) => `uploads/${item.key}`)],
    );
    await chmod(archive, 0o600);
    const encrypted = path.join(stage, "backup.vshub");
    await encryptRecoveryArchive(archive, encrypted, options.keyFile);
    // Publishing with a hard link is atomic and cannot overwrite an older backup.
    await link(encrypted, output);
    return { output, manifest, ...(await digest(output)) };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export async function unpackRecoveryBackup(options: {
  source: string;
  keyFile: string;
  destination: string;
  maxBytes?: number;
}) {
  const destination = path.resolve(options.destination);
  const maxBytes = options.maxBytes ?? defaultMaxBytes;
  check(
    Number.isSafeInteger(maxBytes) && maxBytes > 0,
    "Choose a positive restore size limit.",
  );
  // No recursive mkdir: the caller must choose an existing parent and a NEW target.
  await mkdir(destination, { mode: 0o700 });
  let complete = false;
  try {
    const stage = await privateStage(destination);
    const archive = path.join(stage, "backup.tar.gz");
    check(
      (await stat(options.source)).size <= maxBytes,
      "The encrypted backup exceeds the restore size limit.",
    );
    await decryptArchive(options.source, archive, options.keyFile);
    const entries = new Map<string, number>();
    const names = new Set<string>();
    let valid = true,
      total = 0;
    await tar.list({
      file: archive,
      strict: true,
      onReadEntry(entry) {
        const allowed =
          /^(manifest\.json|database\.(sqlite|dump)|uploads\/[a-z0-9][a-z0-9._-]{0,99})$/i.test(
            entry.path,
          ) && !entry.path.includes("..");
        total += entry.size;
        if (
          !allowed ||
          entry.type !== "File" ||
          names.has(entry.path.toLowerCase()) ||
          !Number.isSafeInteger(entry.size) ||
          entry.size < 0 ||
          total > maxBytes ||
          entries.size >= 100000 ||
          (entry.path === "manifest.json" && entry.size > maxManifestBytes)
        )
          valid = false;
        names.add(entry.path.toLowerCase());
        entries.set(entry.path, entry.size);
      },
    });
    check(
      valid && entries.has("manifest.json"),
      "Unsafe, oversized or duplicate backup archive entries.",
    );
    const content = path.join(stage, "content");
    await mkdir(content, { mode: 0o700 });
    await tar.extract({
      file: archive,
      cwd: content,
      strict: true,
      preserveOwner: false,
      noMtime: true,
      dmode: 0o700,
      fmode: 0o600,
    });
    const manifest = manifestSchema.parse(
      JSON.parse(await readFile(path.join(content, "manifest.json"), "utf8")),
    );
    check(
      manifest.database.file ===
        (manifest.database.engine === "postgres"
          ? "database.dump"
          : "database.sqlite"),
      "Database format does not match the manifest.",
    );
    const expected = new Map<string, z.infer<typeof fileSchema>>([
      [manifest.database.file, manifest.database],
    ]);
    for (const file of manifest.files) {
      const filename = `uploads/${file.key}`;
      check(!expected.has(filename), "Duplicate manifest file.");
      expected.set(filename, file);
    }
    check(
      entries.size === expected.size + 1 &&
        [...expected.keys()].every((filename) => entries.has(filename)),
      "Backup contents differ from the manifest.",
    );
    for (const [filename, recorded] of expected) {
      const actual = await digest(path.join(content, filename));
      check(
        actual.size === recorded.size && actual.sha256 === recorded.sha256,
        "Backup file failed its size or SHA-256 integrity check.",
      );
      await chmod(path.join(content, filename), 0o600);
    }
    if (manifest.database.engine === "sqlite") {
      const db = new Database(path.join(content, manifest.database.file), {
        readonly: true,
        fileMustExist: true,
      });
      try {
        check(
          db.pragma("integrity_check", { simple: true }) === "ok",
          "Restored SQLite database is damaged.",
        );
      } finally {
        db.close();
      }
    }
    await chmod(path.join(content, "manifest.json"), 0o600);
    if (!manifest.files.length)
      await mkdir(path.join(content, "uploads"), { mode: 0o700 });
    for (const filename of await readdir(content))
      await rename(
        path.join(content, filename),
        path.join(destination, filename),
      );
    await rm(stage, { recursive: true, force: true });
    complete = true;
    return { destination, manifest };
  } finally {
    if (!complete) await rm(destination, { recursive: true, force: true });
  }
}
