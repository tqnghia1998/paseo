import { describe, expect, it } from "vitest";
import { formatAgentTooltipTitle, normalizeAgentTooltipTitle } from "./agent-tooltip-title";

describe("agent tooltip title", () => {
  it("keeps the accessible title whole while compacting its visual tooltip", () => {
    const title = `  ${"first line\nsecond line ".repeat(6)} `;

    const accessibleTitle = normalizeAgentTooltipTitle(title);

    expect(accessibleTitle).toBe(
      "first line second line first line second line first line second line first line second line first line second line first line second line",
    );
    expect(formatAgentTooltipTitle(accessibleTitle)).toBe(
      `${accessibleTitle.slice(0, 79).trimEnd()}…`,
    );
  });
});
