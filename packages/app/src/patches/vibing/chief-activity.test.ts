import { describe, expect, it } from "vitest";
import type { SessionState } from "@/stores/session-store";
import type { TurnLiveness } from "@/timeline/turn-liveness";
import { createStore } from "zustand/vanilla";
import type { ProviderSubagentDescriptorPayload } from "@getpaseo/protocol/messages";
import { observeChiefActivity, resolveChiefActivity } from "./chief-activity";

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

it("reports subagent store transitions and unsubscribes on cleanup", () => {
  const sessions = createStore(() => ({ sessions: { s1: session() } }));
  const subagents = createStore(() => ({
    descriptors: new Map<string, ProviderSubagentDescriptorPayload>(),
  }));
  const activities: string[] = [];
  const child: ProviderSubagentDescriptorPayload = {
    id: "child",
    parentAgentId: "agent-1",
    provider: "claude",
    title: null,
    description: null,
    status: "running",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    toolCallId: null,
  };
  const stop = observeChiefActivity({
    sessions,
    subagents,
    session: {
      protocol: 1,
      status: "ready",
      policy: "chief-v1",
      serverId: "s1",
      agentId: "agent-1",
      workspaceId: "ws",
      cwd: "/tmp/chief",
      provider: "claude",
    },
    report: (activity) => activities.push(activity),
  });
  subagents.setState({ descriptors: new Map([["s1\u0000agent-1\u0000child", child]]) });
  subagents.setState({
    descriptors: new Map([["s1\u0000agent-1\u0000child", { ...child, status: "completed" }]]),
  });
  sessions.setState({ sessions: { s1: session({ pendingFor: "agent-1" }) } });
  expect(activities).toEqual(["idle", "working", "idle", "needs-input"]);
  stop();
  subagents.setState({ descriptors: new Map() });
  sessions.setState({ sessions: { s1: session() } });
  expect(activities).toEqual(["idle", "working", "idle", "needs-input"]);
});

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

  it("stays working while a provider subagent is running after the turn ends", () => {
    expect(resolveChiefActivity(session(), "agent-1", true, "s1")).toBe("working");
  });

  it("stays working while a background task is running", () => {
    const state = session();
    (
      state.agents.get("agent-1") as unknown as { backgroundWork: { count: number } }
    ).backgroundWork = { count: 1 };
    expect(resolveChiefActivity(state, "agent-1", false, "s1")).toBe("working");
  });

  it("stays working while a child agent's turn is open", () => {
    const state = session();
    state.agents.set("child", {
      id: "child",
      turn: open,
      labels: { "paseo.parent-agent-id": "agent-1" },
    } as never);
    expect(resolveChiefActivity(state, "agent-1", false, "s1")).toBe("working");
  });

  it("ignores other agents' turns and permissions", () => {
    expect(resolveChiefActivity(session({ turn: open, pendingFor: "agent-2" }), "agent-3")).toBe(
      "idle",
    );
    expect(resolveChiefActivity(session({ pendingFor: "agent-2" }), "agent-1")).toBe("idle");
  });
});
