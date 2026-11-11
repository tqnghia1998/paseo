import { useEffect } from "react";
import { getParentAddressFromLabels } from "@getpaseo/protocol/agent-labels";
import { useProviderSubagentStore } from "@/subagents/provider-store";
import {
  selectAgentTurnPresentation,
  useSessionStore,
  type SessionState,
} from "@/stores/session-store";
import type { ChiefHandshake } from "./chief-handshake";
import type { ChiefActivityState, ChiefSession } from "./chief-session";

function hasAgentWork(session: SessionState, agentId: string): boolean {
  return (
    selectAgentTurnPresentation(session, agentId).isActive ||
    (session.agents.get(agentId)?.backgroundWork?.count ?? 0) > 0
  );
}

/**
 * The single verified Chief agent's activity, from the same stores the chat renders:
 * a pending permission or question (the card the user must answer) needs input, an active
 * turn (the rule `agent-activity.tsx` uses for Bots) is working, anything else is idle.
 * Background work (a background shell or task), a running provider subagent and a Paseo child
 * agent that is still active keep Chief working after its own turn has ended.
 */
export function resolveChiefActivity(
  session: SessionState | undefined,
  agentId: string,
  hasRunningSubagent = false,
  serverId = "",
): ChiefActivityState {
  if (!session) return "idle";
  for (const pending of session.pendingPermissions.values()) {
    if (pending.agentId === agentId) return "needs-input";
  }
  if (hasRunningSubagent || hasAgentWork(session, agentId)) return "working";
  for (const child of session.agents.values()) {
    if (child.archivedAt || child.id === agentId) continue;
    const parent = getParentAddressFromLabels(child.labels, serverId);
    if (parent?.agentId !== agentId) continue;
    if (hasAgentWork(session, child.id)) return "working";
  }
  return "idle";
}

function hasRunningProviderSubagent(
  descriptors: ReturnType<typeof useProviderSubagentStore.getState>["descriptors"],
  serverId: string,
  agentId: string,
): boolean {
  for (const [key, subagent] of descriptors) {
    if (
      key.startsWith(`${serverId}\0`) &&
      subagent.parentAgentId === agentId &&
      subagent.status === "running"
    )
      return true;
  }
  return false;
}

interface ChiefActivitySources {
  sessions: {
    getState(): Pick<ReturnType<typeof useSessionStore.getState>, "sessions">;
    subscribe(listener: () => void): () => void;
  };
  subagents: {
    getState(): Pick<ReturnType<typeof useProviderSubagentStore.getState>, "descriptors">;
    subscribe(listener: () => void): () => void;
  };
  session: ChiefSession;
  report(activity: ChiefActivityState): void;
}

export function observeChiefActivity({
  sessions,
  subagents,
  session,
  report,
}: ChiefActivitySources) {
  let previous: ChiefActivityState | undefined;
  const update = () => {
    const running = hasRunningProviderSubagent(
      subagents.getState().descriptors,
      session.serverId,
      session.agentId,
    );
    const activity = resolveChiefActivity(
      sessions.getState().sessions[session.serverId],
      session.agentId,
      running,
      session.serverId,
    );
    if (activity === previous) return;
    previous = activity;
    report(activity);
  };
  const unsubscribeSession = sessions.subscribe(update);
  const unsubscribeSubagents = subagents.subscribe(update);
  update();
  return () => {
    unsubscribeSession();
    unsubscribeSubagents();
  };
}

/** Keeps the host told while the frame is mounted, visible or not. */
export function useChiefActivityReport(
  session: ChiefSession | null,
  handshake: ChiefHandshake | null,
): void {
  useEffect(() => {
    if (!session || !handshake) return;
    return observeChiefActivity({
      sessions: useSessionStore,
      subagents: useProviderSubagentStore,
      session,
      report: (activity) => handshake.reportActivity(activity),
    });
  }, [session, handshake]);
}
