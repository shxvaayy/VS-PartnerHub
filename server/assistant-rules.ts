import { moduleDefinitions, type Module } from "../shared/domain.js";
import type {
  commonQuestion,
  platformGuide,
  retrieveEvidence,
} from "./ai-retrieval.js";

type Action = NonNullable<ReturnType<typeof commonQuestion>>["action"];
export function workspaceAnswer(
  action: Action,
  guide: ReturnType<typeof platformGuide>,
  lookups: Awaited<ReturnType<typeof retrieveEvidence>>,
  counts: { kind: string; status: string; count: number }[],
) {
  if (!action) return null;
  let answer = "";
  const sourceIds: string[] = [],
    warnings: string[] = [];
  if (action === "records") {
    answer = lookups.records
      .map((group) => {
        const name = moduleDefinitions[group.query.module].label;
        if (group.denied)
          return `Your role does not have access to ${name.toLowerCase()}.`;
        sourceIds.push(
          `module:${group.query.module}`,
          ...group.items.slice(0, 5).map((r) => r.id),
        );
        const filter = group.query.dueBefore
          ? " overdue"
          : group.query.statuses.length
            ? " pending"
            : " matching";
        return group.total
          ? `You have **${group.total}${filter} ${name.toLowerCase()}**. ${group.truncated ? `The latest ${group.items.length} are shown below; open the module for the full list.` : "Here are the current records."}`
          : `There are no${filter} ${name.toLowerCase()} in the records you can access.`;
      })
      .join("\n\n");
  } else if (action === "documents") {
    const documents = lookups.documents;
    if (documents?.denied)
      answer = "Your role does not have access to company documents.";
    else {
      sourceIds.push("module:documents");
      answer = documents?.total
        ? `**${documents.total} company document${documents.total === 1 ? " needs" : "s need"} review.** Open a document to inspect its status and review notes. ${documents.truncated ? `Showing the latest ${documents.items.length} matches.` : ""}`
        : "There are no company documents awaiting review in the records you can access.";
    }
  } else {
    const totals = new Map<string, number>();
    for (const count of counts)
      totals.set(count.kind, (totals.get(count.kind) || 0) + count.count);
    answer = totals.size
      ? "Here's your current workspace activity:\n\n| Module | Records |\n| --- | ---: |\n" +
        [...totals]
          .map(
            ([kind, total]) =>
              `| [${moduleDefinitions[kind as Module].label}](/app/${kind}) | ${total} |`,
          )
          .join("\n")
      : "Your workspace does not contain any business records yet. Open an available module to get started.";
    sourceIds.push(...[...totals.keys()].map((kind) => `module:${kind}`));
  }
  return {
    result: {
      answer,
      sourceIds: [...new Set(sourceIds)].slice(0, 30),
      warnings,
      suggestions: [],
    },
    model: null,
    usage: { input: 0, output: 0 },
    engine: "workspace",
  };
}
