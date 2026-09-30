// Read only explicit, unambiguous constraints. Semantic interpretation remains
// with the language model; these facts keep clearly stated values from being
// dropped between the brief and the editable form.
export function explicitRequirementFacts(brief: string) {
  const clauses = brief.normalize("NFKC").split(/[\n.!?;,]+/);
  const negated = (text: string) =>
    /\b(?:no|not|never|without|cannot|can't|isn't|aren't|wasn't|weren't|nahi|nahin|nhi)\b|नहीं|नही|मत/i.test(
      text,
    );
  const arrangements = clauses.flatMap((clause) => {
    if (negated(clause)) return [];
    return [
      ...clause.matchAll(
        /\b(?:fully remote|100% remote|remote (?:team|work|role|position)|hybrid (?:team|work|role|position)|on[ -]?site (?:team|work|role|position))\b/gi,
      ),
    ].map((match) => match[0]);
  });
  const date = (label: string) => {
    const values = clauses
      .filter((clause) => !negated(clause))
      .flatMap((clause) =>
        [
          ...clause.matchAll(
            new RegExp(
              `\\b(?:${label})(?:\\s+(?:date|by|on|from|is|of))*\\s*[:=]?\\s*(\\d{4}-\\d{2}-\\d{2})\\b`,
              "gi",
            ),
          ),
        ].map((match) => match[1]),
      );
    const unique = [...new Set(values)];
    if (unique.length !== 1) return undefined;
    const parsed = Date.parse(unique[0]);
    return Number.isFinite(parsed) &&
      new Date(parsed).toISOString().slice(0, 10) === unique[0]
      ? unique[0]
      : undefined;
  };
  return {
    workArrangement: [
      ...new Set(arrangements.map((value) => value.toLowerCase())),
    ]
      .map((value) => value[0].toUpperCase() + value.slice(1))
      .join("; "),
    requiredDate: date("joining|start|starting|delivery|required"),
    responseDeadline: date(
      "response deadline|submission deadline|application deadline|deadline",
    ),
  };
}

export function preserveRequirementFacts(
  brief: string,
  payload: Record<string, any>,
) {
  const facts = explicitRequirementFacts(brief);
  if (facts.requiredDate) payload.required_date = facts.requiredDate;
  if (facts.responseDeadline) payload.deadline = facts.responseDeadline;
  if (payload.requirement_type === "hiring") {
    if (payload.positions > 0 && payload.quantity === 0)
      payload.quantity = payload.positions;
    if (
      facts.workArrangement &&
      !/\b(?:remote|hybrid|on[ -]?site)\b/i.test(
        payload.delivery_requirements || "",
      )
    ) {
      payload.delivery_requirements = [
        facts.workArrangement,
        payload.delivery_requirements,
      ]
        .filter(Boolean)
        .join(". ")
        .slice(0, 3000);
    }
  }
  return facts;
}
