import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { DocumentAiProgress } from "../../shared/ai";
let csrfToken = "";
export function setCsrf(token: string) {
  csrfToken = token;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: { field: string; message: string }[],
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (
    options.body instanceof FormData &&
    /^\/documents\/?$/.test(path) &&
    options.method?.toUpperCase() === "POST"
  ) {
    const file = options.body.get("file");
    if (!(file instanceof File) || !file.size)
      throw new ApiError("Choose a PDF, PNG or JPEG document.", 422);
    const document = Object.fromEntries(
      [...options.body.entries()].filter(([key]) => key !== "file"),
    );
    const ticket = await api<{
      transport: "multipart" | "direct";
      id?: string;
      pathname?: string;
      token?: string;
    }>("/documents/uploads", {
      method: "POST",
      signal: options.signal,
      body: JSON.stringify({
        document,
        file: {
          name: file.name.slice(0, 200),
          type: file.type,
          size: file.size,
        },
      }),
    });
    if (ticket.transport === "direct") {
      const { put } = await import("@vercel/blob/client");
      try {
        await put(ticket.pathname!, file, {
          access: "private",
          token: ticket.token!,
          contentType: file.type,
          abortSignal: options.signal || undefined,
        });
      } catch (error) {
        if (options.signal?.aborted) throw error;
        throw new ApiError(
          "The upload could not finish. Check your connection and try again.",
          503,
        );
      }
      return api<T>(`/documents/uploads/${ticket.id}/complete`, {
        method: "POST",
        signal: options.signal,
        body: "{}",
      });
    }
  }
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: "include",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (
      response.status === 401 &&
      !/^\/auth\/(login|verify-login|resend-login)(?:[/?]|$)/.test(path)
    )
      window.dispatchEvent(new Event("partnerhub:session-invalid"));
    throw new ApiError(
      data.error || "The connection was interrupted. Please try again.",
      response.status,
      data.details,
    );
  }
  return data;
}
export async function documentAiRequest<T>(
  path: string,
  options: RequestInit,
  progress: (progress: DocumentAiProgress) => void,
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "text/event-stream");
  if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: "include",
  });
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("text/event-stream")
  ) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401)
      window.dispatchEvent(new Event("partnerhub:session-invalid"));
    if (!response.ok)
      throw new ApiError(
        data.error || "The document could not be processed. Please try again.",
        response.status,
        data.details,
      );
    return data;
  }
  const reader = response.body?.getReader();
  if (!reader)
    throw new ApiError(
      "The connection was interrupted. Please try again.",
      502,
    );
  const decoder = new TextDecoder();
  let buffer = "",
    result: T | undefined;
  try {
    for (;;) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      if (buffer.length > 8 * 1024 * 1024)
        throw new ApiError(
          "The document response was too large. Try fewer pages.",
          502,
        );
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const kind = event.match(/^event: (.+)$/m)?.[1];
        const payload = event
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6))
          .join("\n");
        if (!payload) continue;
        const data = JSON.parse(payload);
        if (kind === "error")
          throw new ApiError(data.error, data.status || 502);
        if (kind === "result") result = data;
        if (
          kind === "progress" &&
          ["uploaded", "reading", "extracting", "validating", "ready"].includes(
            data.stage,
          )
        )
          progress({
            stage: data.stage,
            pagesRead: data.pagesRead,
            totalPages: data.totalPages,
          });
      }
      if (chunk.done) break;
    }
  } finally {
    reader.releaseLock();
  }
  if (result === undefined)
    throw new ApiError(
      "The connection was interrupted before the analysis finished. Please try again.",
      502,
    );
  return result;
}
export function useApi<T = any>(path: string, enabled = true) {
  return useQuery<T, ApiError>({
    queryKey: [path],
    queryFn: ({ signal }) => api<T>(path, { signal }),
    enabled,
    staleTime: 15000,
  });
}
export function useAction<T = any>(path: string, method = "POST") {
  const client = useQueryClient();
  return useMutation<T, ApiError, any>({
    mutationFn: (data) =>
      api<T>(path, {
        method,
        body: data instanceof FormData ? data : JSON.stringify(data),
      }),
    onSuccess: () => {
      client.invalidateQueries();
    },
  });
}
export function queryString(values: Record<string, unknown>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "")
      params.set(key, String(value));
  });
  return params.toString();
}
