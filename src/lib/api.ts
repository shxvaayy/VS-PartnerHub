import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  if (!response.ok)
    throw new ApiError(
      data.error || "The connection was interrupted. Please try again.",
      response.status,
      data.details,
    );
  return data;
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
