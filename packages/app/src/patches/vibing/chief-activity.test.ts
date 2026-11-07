import { describe, expect, it } from "vitest";
import type { SessionState } from "@/stores/session-store";
import type { TurnLiveness } from "@/timeline/turn-liveness";
import { resolveChiefActivity } from "./chief-activity";

const idle: TurnLiveness = { phase: "idle", cancellationRequestId: null };
const open: TurnLiveness = {
  phase: "open",
  turnId: "t1",
  startedAt: new Date(0),
  cancellationRequestId: null,
};

// Only the fields the real `selectAgentTurnPresentation` and the permission scan read.
function session(
  options: { turn?: TurnLiveness; pendingFor?: string; submitting?: boolean } = {},
): SessionState {
  return {
    agents: new Map([["agent-1", { id: "agent-1", turn: options.turn ?? idle }]]),
    agentDetails: new Map(),
    messageSubmissions: new Map(
      options.submitting ? [["agent-1", [{ providerAcknowledged: false }]]] : [],
    ),
    pendingPermissions: new Map(
      options.pendingFor ? [["p1", { key: "p1", agentId: options.pendingFor, request: {} }]] : [],
    ),
  } as unknown as SessionState;
}

describe("resolveChiefActivity", () => {
  it("is idle without a session or an active turn", () => {
    expect(resolveChiefActivity(undefined, "agent-1")).toBe("idle");
    expect(resolveChiefActivity(session(), "agent-1")).toBe("idle");
  });

  it("is working while the agent's turn is open", () => {
    expect(resolveChiefActivity(session({ turn: open }), "agent-1")).toBe("working");
  });

  it("is working from send, before the provider acknowledges the message", () => {
    expect(resolveChiefActivity(session({ submitting: true }), "agent-1")).toBe("working");
  });

  it("needs input while the agent has a pending permission or question, even mid-turn", () => {
    expect(resolveChiefActivity(session({ turn: open, pendingFor: "agent-1" }), "agent-1")).toBe(
      "needs-input",
    );
    expect(resolveChiefActivity(session({ pendingFor: "agent-1" }), "agent-1")).toBe("needs-input");
  });

  it("ignores other agents' turns and permissions", () => {
    expect(resolveChiefActivity(session({ turn: open, pendingFor: "agent-2" }), "agent-3")).toBe(
      "idle",
    );
    expect(resolveChiefActivity(session({ pendingFor: "agent-2" }), "agent-1")).toBe("idle");
  });
});
