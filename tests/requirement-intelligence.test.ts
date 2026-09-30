import { describe, expect, it } from "vitest";
import {
  explicitRequirementFacts,
  preserveRequirementFacts,
} from "../server/requirement-intelligence.js";

describe("explicit requirement constraints", () => {
  it("preserves a dropped remote-work constraint, stated joining date and known headcount in the editable draft", () => {
    const draft = {
      requirement_type: "hiring",
      delivery_requirements: "Provide equipment before joining",
      positions: 4,
      quantity: 0,
      required_date: "",
      deadline: "",
    };
    preserveRequirementFacts(
      "Pune ke liye 4 developers chahiye. Remote team, joining by 2027-01-20. Response deadline: 2026-12-30.",
      draft,
    );
    expect(draft).toMatchObject({
      delivery_requirements: "Remote team. Provide equipment before joining",
      positions: 4,
      quantity: 4,
      required_date: "2027-01-20",
      deadline: "2026-12-30",
    });
  });
  it("does not turn negations, company names or remote interviews into a remote-work commitment", () => {
    for (const brief of [
      "No remote work is available.",
      "Remote work nahi chahiye.",
      "Remote work नहीं चाहिए।",
      "Recruit for Remote Systems Ltd.",
      "The initial remote interview is on Monday.",
    ])
      expect(explicitRequirementFacts(brief).workArrangement).toBe("");
    expect(
      explicitRequirementFacts("Not joining by 2027-01-20").requiredDate,
    ).toBeUndefined();
  });
  it("leaves ambiguous and impossible dates to human review", () => {
    for (const brief of [
      "Delivery by 2027-02-30.",
      "Start by 04/05/2027.",
      "Joining by 2027-01-20; joining by 2027-02-15 instead.",
    ])
      expect(explicitRequirementFacts(brief).requiredDate).toBeUndefined();
  });
  it("keeps a detailed work arrangement and does not invent an unknown headcount", () => {
    const draft = {
      requirement_type: "hiring",
      delivery_requirements: "Hybrid work: two office days each week.",
      positions: 0,
      quantity: 0,
    };
    preserveRequirementFacts(
      "Hybrid work for the support team; headcount to be confirmed.",
      draft,
    );
    expect(draft.delivery_requirements).toBe(
      "Hybrid work: two office days each week.",
    );
    expect(draft.quantity).toBe(0);
    expect(draft.positions).toBe(0);
  });
});
