import { useEffect, useMemo } from "react";
import { usePathname } from "expo-router";
import { isWeb } from "@/constants/platform";
import { selectAgentTurnPresentation, useSessionStore } from "@/stores/session-store";
import type { WorkspaceAgentActivity } from "@/utils/workspace-agent-activity";
import {
  parseHostAgentRouteFromPathname,
  parseHostWorkspaceRouteFromPathname,
} from "@/utils/host-routes";

export const EMBEDDED_AGENT_ACTIVITY_EVENT_TYPE = "paseo:agent-activity";
export const EMBEDDED_AGENT_ACTIVITY_REQUEST_TYPE = "space:paseo-agent-activity-request";

export function isWorkspaceActivityRunning(
  activity: WorkspaceAgentActivity | undefined,
  isTurnActive: boolean,
): boolean {
  return activity?.status === "running" || isTurnActive;
}

export function createEmbeddedAgentActivityEvent(running: boolean) {
  return {
    type: EMBEDDED_AGENT_ACTIVITY_EVENT_TYPE,
    running,
  } as const;
}

function publishEmbeddedAgentActivity(running: boolean): void {
  const event = createEmbeddedAgentActivityEvent(running);
  console.info(JSON.stringify(event));
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
  const pathname = usePathname();
  const workspaceRoute = useMemo(() => parseHostWorkspaceRouteFromPathname(pathname), [pathname]);
  const agentRoute = useMemo(() => parseHostAgentRouteFromPathname(pathname), [pathname]);
  const serverId = workspaceRoute?.serverId ?? agentRoute?.serverId ?? null;
  const workspaceId = useSessionStore((state) => {
    if (workspaceRoute) return workspaceRoute.workspaceId;
    if (!agentRoute) return null;
    return state.sessions[agentRoute.serverId]?.agents.get(agentRoute.agentId)?.workspaceId ?? null;
  });
  const activity = useSessionStore((state) => {
    if (!serverId || !workspaceId) return undefined;
    return state.sessions[serverId]?.workspaceAgentActivity.get(workspaceId);
  });
  const isTurnActive = useSessionStore((state) => {
    if (!serverId || !activity) return false;
    return selectAgentTurnPresentation(state.sessions[serverId], activity.agentId).isActive;
  });
  const running = isWorkspaceActivityRunning(activity, isTurnActive);

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
