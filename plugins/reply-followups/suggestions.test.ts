import { describe, expect, it } from "vitest";
import { readSuggestions } from "./shared/suggestions.js";

const heading = "**Possible next prompts**";

describe("readSuggestions", () => {
  it("accepts one or two short, localized prompts in the final section", () => {
    expect(
      readSuggestions(`Done.\r\n\r\n${heading}\r\n- Run the focused tests\r\n- 重跑測試`),
    ).toEqual(["Run the focused tests", "重跑測試"]);
    expect(readSuggestions(`${heading}\n- Show the changes`)).toEqual(["Show the changes"]);
  });

  it.each([
    "Done.",
    `${heading}\n- Run tests\n\nMore prose`,
    `${heading}\n- One\n- Two\n- Three`,
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
