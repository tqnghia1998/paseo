import { useEffect } from "react";
import {
  selectAgentTurnPresentation,
  useSessionStore,
  type SessionState,
} from "@/stores/session-store";
import type { ChiefHandshake } from "./chief-handshake";
import type { ChiefActivityState, ChiefSession } from "./chief-session";

/**
 * The single verified Chief agent's activity, from the same stores the chat renders:
 * a pending permission or question (the card the user must answer) needs input, an active
 * turn (the rule `agent-activity.tsx` uses for Bots) is working, anything else is idle.
 */
export function resolveChiefActivity(
  session: SessionState | undefined,
  agentId: string,
): ChiefActivityState {
  if (!session) return "idle";
  for (const pending of session.pendingPermissions.values()) {
    if (pending.agentId === agentId) return "needs-input";
  }
  return selectAgentTurnPresentation(session, agentId).isActive ? "working" : "idle";
}

/** Keeps the host told while the frame is mounted, visible or not. */
export function useChiefActivityReport(
  session: ChiefSession | null,
  handshake: ChiefHandshake | null,
): void {
  const activity = useSessionStore((state) =>
    session ? resolveChiefActivity(state.sessions[session.serverId], session.agentId) : "idle",
  );
  useEffect(() => {
    handshake?.reportActivity(activity);
  }, [activity, handshake]);
}
