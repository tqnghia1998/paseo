import type { ManagedAgent } from "../../server/agent/agent-manager.js";

const CHAT_CONTEXT_LABEL = "paseo-bots.context";

// Surface context follows delegation; bot ownership and routine labels do not.
// A parent without labels (as in upstream's partial test agents) passes none on.
export function botChatChildLabels(
  parent: Partial<Pick<ManagedAgent, "labels">> | null,
): Record<string, string> {
  return parent?.labels?.[CHAT_CONTEXT_LABEL] === "live-design"
    ? { [CHAT_CONTEXT_LABEL]: "live-design" }
    : {};
}
