import { expect, test } from "vitest";
import {
  assertConfiguredMcpInventory,
  isConfiguredMcpToolAllowed,
} from "./configured-mcp-policy.js";
const config = {
  providerOptions: { restrictToConfiguredMcp: true },
  toolPolicy: { preapproved: [{ kind: "mcp" as const, server: "chief", tool: "list_apps" }] },
};
test("restricted query initialization requires the exact effective MCP inventory", () => {
  expect(() => assertConfiguredMcpInventory(config, ["mcp__chief__list_apps"])).not.toThrow();
  for (const inventory of [
    undefined,
    [],
    ["Bash"],
    ["mcp__chief__list_apps", "mcp__inherited__write"],
  ]) {
    expect(() => assertConfiguredMcpInventory(config, inventory)).toThrow(
      "Configured MCP inventory mismatch",
    );
  }
  expect(() => assertConfiguredMcpInventory({}, ["Bash"])).not.toThrow();
});
test("permission fallback never admits an ungranted native or MCP tool", () => {
  expect(isConfiguredMcpToolAllowed(config, "mcp__chief__list_apps")).toBe(true);
  expect(isConfiguredMcpToolAllowed(config, "Bash")).toBe(false);
  expect(isConfiguredMcpToolAllowed(config, "mcp__chief__publish")).toBe(false);
  expect(isConfiguredMcpToolAllowed({}, "Bash")).toBe(true);
});
