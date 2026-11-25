import { describe, expect, it } from "vitest";
import { HEADING, INSTRUCTIONS, readSuggestions } from "./shared/suggestions.js";

const heading = HEADING;

describe("INSTRUCTIONS", () => {
  it("aligns with GenUI fences, render_ui, and conversational follow-up questions", () => {
    expect(INSTRUCTIONS).toContain(HEADING);
    expect(INSTRUCTIONS).toContain("including factual Q&A, coding tasks");
    expect(INSTRUCTIONS).toContain("outside and after the closing fence");
    expect(INSTRUCTIONS).toContain("render_ui");
    expect(INSTRUCTIONS).toContain("instead of GenUI FollowUps()");
  });
});

describe("readSuggestions", () => {
  it("accepts any number of short, localized prompts in the final section, including after GenUI fences", () => {
    expect(
      readSuggestions(`Done.\r\n\r\n${heading}\r\n- Run the focused tests\r\n- 重跑測試`),
    ).toEqual(["Run the focused tests", "重跑測試"]);
    expect(readSuggestions(`${heading}\n- Show the changes`)).toEqual(["Show the changes"]);
    expect(readSuggestions(`Done.\n\n${heading}\n- One\n- Two\n- Three\n- Four`)).toEqual([
      "One",
      "Two",
      "Three",
      "Four",
    ]);
    expect(
      readSuggestions(
        `Elon Musk is **55 years old**.\n\n\`\`\`ui\nCard("Elon Musk — Age", [Metric("Age", "55")])\n\`\`\`\n\n${heading}\n- What is his net worth?\n- Tell me about SpaceX's early days`,
      ),
    ).toEqual(["What is his net worth?", "Tell me about SpaceX's early days"]);
  });

  it.each([
    "Done.",
    `${heading}\n- Run tests\n\nMore prose`,
    `${heading}\n- Run tests\n- run tests`,
    `${heading}\n- ${"x".repeat(121)}`,
    `\`\`\`md\n${heading}\n- Example`,
    `\`\`\`md\n${heading}\n- Example\n\`\`\``,
    `${heading}\n- [Open](https://example.test)`,
    `${heading}\n- Run\u202Ethis`,
  ])("ignores nonconforming output: %s", (text) => {
    expect(readSuggestions(text)).toEqual([]);
  });
});
