import { spawnSync } from "node:child_process";

if (process.env.VERCEL_ENV === "production") {
  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL_UNPOOLED)
    throw new Error(
      "Connect the production PostgreSQL database before deploying.",
    );
  const result = spawnSync(
    process.execPath,
    ["build/server/cli.js", "migrate"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL: process.env.DATABASE_URL_UNPOOLED,
      },
    },
  );
  if (result.status !== 0) process.exit(result.status || 1);
}
