import type { AgentSessionConfig } from "../../agent-sdk-types.js";

type Policy = Pick<Partial<AgentSessionConfig>, "providerOptions" | "toolPolicy">;
function names(config: Policy): string[] {
  return (config.toolPolicy?.preapproved ?? []).map(
    (grant) => `mcp__${grant.server}__${grant.tool}`,
  );
}
export function isConfiguredMcpToolAllowed(config: Policy, tool: string): boolean {
  return config.providerOptions?.restrictToConfiguredMcp !== true || names(config).includes(tool);
}
export function assertConfiguredMcpInventory(config: Policy, inventory: unknown): void {
  if (config.providerOptions?.restrictToConfiguredMcp !== true) return;
  const expected = names(config).sort();
  if (
    !Array.isArray(inventory) ||
    inventory.some((tool) => typeof tool !== "string") ||
    JSON.stringify([...inventory].sort()) !== JSON.stringify(expected)
  ) {
    throw new Error("Configured MCP inventory mismatch");
  }
}
