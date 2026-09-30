export function listReturnPath(
  state: unknown,
  fallback: string,
  allowedPaths: readonly string[] = [fallback],
): string {
  const returnTo = (state as { returnTo?: unknown } | null)?.returnTo;
  return typeof returnTo === "string" &&
    allowedPaths.some(
      (path) => returnTo === path || returnTo.startsWith(`${path}?`),
    )
    ? returnTo
    : fallback;
}
