import { createHmac } from "node:crypto";
import type { Options, Store } from "express-rate-limit";
import { config } from "./config.js";
import { db, now } from "./db.js";

// Shared, atomic limits survive function cold starts and concurrent instances.
// Only keyed hashes of network identifiers are retained in the database.
export class DatabaseRateLimitStore implements Store {
  localKeys = false;
  private windowMs = 60000;
  constructor(readonly prefix: string) {}
  init(options: Options) {
    this.windowMs = options.windowMs;
  }
  private key(value: string) {
    return createHmac("sha256", config.sessionSecret)
      .update(`request-limit:${this.prefix}:${value}`)
      .digest("hex");
  }
  async increment(value: string) {
    const at = now();
    const expires = new Date(Date.now() + this.windowMs).toISOString();
    const [row] = await db("auth_attempts")
      .insert({ key: this.key(value), attempts: 1, expires_at: expires })
      .onConflict("key")
      .merge({
        attempts: db.raw("case when ?? <= ? then 1 else ?? + 1 end", [
          "auth_attempts.expires_at",
          at,
          "auth_attempts.attempts",
        ]),
        expires_at: db.raw("case when ?? <= ? then ? else ?? end", [
          "auth_attempts.expires_at",
          at,
          expires,
          "auth_attempts.expires_at",
        ]),
      })
      .returning(["attempts", "expires_at"]);
    return {
      totalHits: Number(row.attempts),
      resetTime: new Date(row.expires_at),
    };
  }
  async decrement(value: string) {
    await db("auth_attempts")
      .where({ key: this.key(value) })
      .where("attempts", ">", 0)
      .decrement("attempts", 1);
  }
  async resetKey(value: string) {
    await db("auth_attempts")
      .where({ key: this.key(value) })
      .delete();
  }
}
