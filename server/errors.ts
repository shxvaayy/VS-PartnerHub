import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function assert(
  condition: unknown,
  status: number,
  message: string,
): asserts condition {
  if (!condition) throw new HttpError(status, message);
}
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (res.headersSent) {
    _next(error);
    return;
  }
  if (error instanceof ZodError) {
    res.status(422).json({
      error: "Please check the highlighted information.",
      details: error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
    });
    return;
  }
  if (error instanceof HttpError) {
    res
      .status(error.status)
      .json({ error: error.message, details: error.details });
    return;
  }
  if (error.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "Choose a file smaller than 10 MB." });
    return;
  }
  if (error.code?.startsWith("LIMIT_")) {
    res
      .status(400)
      .json({ error: "Only one document can be uploaded at a time." });
    return;
  }
  if (error.code === "SQLITE_CONSTRAINT_UNIQUE" || error.code === "23505") {
    res
      .status(409)
      .json({ error: "This entry already exists. Refresh and try again." });
    return;
  }
  if (error.type === "entity.too.large") {
    res.status(413).json({ error: "The request is too large." });
    return;
  }
  if (error instanceof SyntaxError && "body" in error) {
    res.status(400).json({ error: "Invalid JSON request." });
    return;
  }
  console.error(
    "Request failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  res
    .status(500)
    .json({ error: "We couldn’t complete that request. Please try again." });
};
