export interface AiAction {
  label: string;
  href: string;
}

export const aiActionLabels: Record<string, string> = {
  "/app/ai": "Ask your workspace",
  "/app/ai?mode=document": "Extract a document",
  "/app/ai?mode=draft": "Draft a requirement",
  "/app/ai?mode=comparison": "Compare quotations",
  "/app/ai?mode=discovery": "Find partners",
  "/app/ai?mode=alerts": "View operational alerts",
};

// Actions come from the authorized application guide, never from model-generated
// URLs or labels. Reapply this when reading history because permissions can change.
export function allowedAiActions(requested: AiAction[], available: AiAction[]) {
  const allowed = new Map(available.map((action) => [action.href, action]));
  return [...new Set(requested.map((action) => action.href))].flatMap((href) =>
    allowed.has(href) ? [allowed.get(href)!] : [],
  );
}

// Keep navigation in named controls, including for previously saved responses.
// The original stored history is not rewritten by this presentation step.
export function presentAiText(text: string, available: AiAction[] = []) {
  const found: AiAction[] = [];
  const action = (href: string) => {
    const normalized = href.replace(/^https?:\/\/[^/]+/i, "");
    const match = available.find((item) => item.href === normalized);
    if (match && !found.some((item) => item.href === match.href))
      found.push(match);
    return match;
  };
  let content = text.replace(
    /\[([^\]]+)\]\(((?:https?:\/\/[^/\s]+)?\/app(?:[/?#][^\s)]*)?)\)/gi,
    (_match, label: string, href: string) => {
      action(href);
      return label;
    },
  );
  const route = String.raw`(?:https?:\/\/[a-z0-9.-]+(?::[0-9]+)?)?\/app(?=[/?#\s).,;:\x60]|$)(?:\/[a-z0-9_/-]*)?(?:\?[a-z0-9_%=&+-]*)?(?:#[a-z0-9_%-]*)?`;
  content = content.replace(
    new RegExp(`\\b(?:at|via|through)\\s+\\x60?(${route})\\x60?`, "gi"),
    (_match, href: string) => {
      action(href);
      return "";
    },
  );
  content = content.replace(
    new RegExp(`\\x60?(${route})\\x60?`, "gi"),
    (_match, href: string) => action(href)?.label || "your workspace",
  );
  content = content
    .replace(/[ \t]+([.,;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { content, actions: found };
}
