import { describe, expect, it } from "vitest";
import {
  aiActionLabels,
  allowedAiActions,
  presentAiText,
} from "../shared/ai-presentation.js";
import { legacyCapabilityReply } from "./fixtures/ai-reply.js";

const actions = Object.entries(aiActionLabels).map(([href, label]) => ({
  href,
  label,
}));

describe("VS AI customer-facing presentation", () => {
  it("removes every raw route in the reported legacy reply and provides six named actions", () => {
    const result = presentAiText(legacyCapabilityReply, actions);
    expect(result.content).not.toMatch(/\/app|mode=| at\s*\./);
    expect(result.content).toContain("read PDFs or images");
    expect(result.actions).toHaveLength(6);
    expect(result.actions.map((action) => action.label)).toContain(
      "Extract a document",
    );
  });
  it("handles Markdown, code-formatted and absolute internal routes without exposing query parameters", () => {
    const reply =
      "Read [your document](/app/documents?document=123). Start via `/app/ai?mode=document`. [Draft a requirement](https://partner.example/app/ai?mode=draft). Open /app/ai?mode=discovery.";
    const result = presentAiText(reply, actions);
    expect(result.content).not.toMatch(/\/app|https:|mode=|document=|`/);
    expect(result.content).toContain("Read your document.");
    expect(result.actions).toHaveLength(3);
  });
  it("does not turn unapproved destinations into navigation or change recorded business values", () => {
    const result = presentAiText(
      "Invoice INV-2026-114: INR 14,550.00, due 2026-10-30. [Approve](/app/verification).",
      actions,
    );
    expect(result.actions).toEqual([]);
    expect(result.content).toBe(
      "Invoice INV-2026-114: INR 14,550.00, due 2026-10-30. Approve.",
    );
    expect(
      allowedAiActions(
        [
          { href: "/app/verification", label: "Admin" },
          { href: "/app/ai?mode=document", label: "/app/ai?mode=document" },
          actions[1],
        ],
        actions,
      ),
    ).toEqual([actions[1]]);
  });
});
