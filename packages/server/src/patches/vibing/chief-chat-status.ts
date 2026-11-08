import type { ManagedAgent } from "../../server/agent/agent-manager.js";
import type { StoredAgentRecord } from "../../server/agent/agent-storage.js";

export type ChiefChatStatus = "working" | "needs-input" | "idle" | "failed";

/** One status contract for handoff receipts, chat lists and chat reads. */
export function chiefChatStatus(
  live: ManagedAgent | null,
  record: StoredAgentRecord | null | undefined,
  canceled = false,
  inFlight = false,
): ChiefChatStatus {
  if (live) {
    if (live.pendingPermissions.size > 0) return "needs-input";
    if (
      inFlight ||
      live.lifecycle === "running" ||
      live.lifecycle === "initializing" ||
      live.activeTurnId
    )
      return "working";
    return live.lifecycle === "error" || live.lastError || canceled ? "failed" : "idle";
  }
  if (inFlight) return "working";
  return record?.lastStatus === "error" ||
    record?.lastError ||
    record?.attentionReason === "error" ||
    canceled
    ? "failed"
    : "idle";
}
