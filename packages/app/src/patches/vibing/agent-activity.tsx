import { useEmbeddedWorkspace, isEmbeddedWorkspaceAllowed } from "./workspace-boundary";
import { useEffect } from "react";
import { isWeb } from "@/constants/platform";
import { selectAgentTurnPresentation, useSessionStore, type Agent } from "@/stores/session-store";
import { isBotChatContext } from "./bot-chat-scope";
export const EMBEDDED_AGENT_ACTIVITY_EVENT_TYPE = "paseo:agent-activity";
export const EMBEDDED_AGENT_ACTIVITY_REQUEST_TYPE = "space:paseo-agent-activity-request";

export function isEmbeddedWorkspaceRunning(
  agents: Iterable<Pick<Agent, "id" | "workspaceId" | "archivedAt" | "labels">>,
  workspaceId: string,
  isTurnActive: (agentId: string) => boolean,
  isWorkspaceAllowed?: (workspaceId: string | null | undefined) => boolean,
): boolean {
  for (const agent of agents) {
    const belongs = isWorkspaceAllowed
      ? isWorkspaceAllowed(agent.workspaceId)
      : agent.workspaceId === workspaceId;
    if (!agent.archivedAt && belongs && isBotChatContext(agent) && isTurnActive(agent.id))
      return true;
  }
  return false;
}

export function createEmbeddedAgentActivityEvent(running: boolean) {
  return {
    type: EMBEDDED_AGENT_ACTIVITY_EVENT_TYPE,
    running,
  } as const;
}

function publishEmbeddedAgentActivity(running: boolean): void {
  const event = createEmbeddedAgentActivityEvent(running);
  if (window.parent !== window) {
    window.parent.postMessage(event, "*");
  }
}

export function isEmbeddedAgentActivityRequest(data: unknown): boolean {
  return (
    data !== null &&
    typeof data === "object" &&
    "type" in data &&
    data.type === EMBEDDED_AGENT_ACTIVITY_REQUEST_TYPE
  );
}

export function EmbeddedAgentActivityBridge() {
  const workspace = useEmbeddedWorkspace();
  const serverId = workspace?.serverId;
  const workspaceId = workspace?.workspaceId;
  const running = useSessionStore((state) => {
    if (!serverId || !workspaceId) return false;
    const session = state.sessions[serverId];
    if (!session) return false;
    return isEmbeddedWorkspaceRunning(
      session.agents.values(),
      workspaceId,
      (agentId) => selectAgentTurnPresentation(session, agentId).isActive,
      (id) => isEmbeddedWorkspaceAllowed(serverId, id),
    );
  });

  useEffect(() => {
    if (!isWeb) return;
    publishEmbeddedAgentActivity(Boolean(serverId && workspaceId && running));
  }, [running, serverId, workspaceId]);

  useEffect(() => {
    if (!isWeb || window.parent === window) return;
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || !isEmbeddedAgentActivityRequest(event.data)) return;
      publishEmbeddedAgentActivity(Boolean(serverId && workspaceId && running));
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [running, serverId, workspaceId]);

  return null;
}
