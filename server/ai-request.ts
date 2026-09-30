import type { Request, Response, RequestHandler } from "express";
import {
  aiRequestTimeout,
  type DocumentAiStage,
  type DocumentAiProgress,
} from "../shared/ai.js";
import { HttpError } from "./errors.js";

export function assertAiRequestActive(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  if (signal.reason?.name === "TimeoutError")
    throw new HttpError(
      504,
      "VS AI took too long to respond. Please try again with a shorter request.",
    );
  throw new HttpError(499, "VS AI request stopped.");
}

// Cancelling a browser request also stops provider work and releases its user lock.
export const aiRequestLifecycle: RequestHandler = (req, res, next) => {
  if (req.method !== "POST") return next();
  const controller = new AbortController();
  const timeout = setTimeout(
    () =>
      controller.abort(
        new DOMException("AI deadline exceeded", "TimeoutError"),
      ),
    aiRequestTimeout(req.path === "/extract-document"),
  );
  timeout.unref();
  const abort = () =>
    controller.abort(new DOMException("Request closed", "AbortError"));
  const cleanup = () => {
    clearTimeout(timeout);
    req.off("aborted", abort);
    res.off("close", close);
    res.off("finish", cleanup);
  };
  const close = () => {
    if (!res.writableEnded) abort();
    cleanup();
  };
  req.once("aborted", abort);
  res.once("close", close);
  res.once("finish", cleanup);
  res.locals.aiSignal = controller.signal;
  next();
};

// Progress is emitted only when the server reaches an actual processing stage.
// JSON remains supported for API clients; the browser opts into POST event data.
export function aiTaskResponse(
  task: (
    req: Request,
    res: Response,
    progress: (
      stage: DocumentAiStage,
      detail?: Omit<DocumentAiProgress, "stage">,
    ) => void,
  ) => Promise<unknown>,
): RequestHandler {
  return async (req, res, next) => {
    const events =
      req.accepts(["text/event-stream", "application/json"]) ===
        "text/event-stream" && req.get("accept")?.includes("text/event-stream");
    const send = (event: string, data: unknown) => {
      if (res.destroyed || res.writableEnded) return;
      if (!res.headersSent) {
        res.set({
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Accel-Buffering": "no",
        });
        res.flushHeaders();
      }
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    try {
      const result = await task(req, res, (stage, detail) => {
        assertAiRequestActive(res.locals.aiSignal);
        if (events) send("progress", { stage, ...detail });
      });
      if (!events) {
        res.json(result);
        return;
      }
      send("result", result);
      res.end();
    } catch (error) {
      if (!res.headersSent) return next(error);
      send("error", {
        status: error instanceof HttpError ? error.status : 500,
        error:
          error instanceof HttpError
            ? error.message
            : "The document could not be processed. Please try again.",
      });
      res.end();
    }
  };
}
