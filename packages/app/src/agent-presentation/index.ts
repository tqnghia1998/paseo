import { useShallow } from "zustand/shallow";
import { useTranslation } from "react-i18next";
import { isAgentRunning } from "@getpaseo/protocol/agent-state-bucket";
import { i18n } from "@/i18n/i18next";
import { useProviderIcon } from "@/components/provider-icons";
import type { PanelDescriptor } from "@/panels/panel-registry";
import {
  useSessionStore,
  selectAgentTurnPresentation,
  type Agent,
  type SessionState,
} from "@/stores/session-store";
import { useProviderSubagentStore } from "@/subagents/provider-store";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";

function formatProviderLabel(provider: Agent["provider"]): string {
  if (!provider) {
    return "Agent";
  }
  return provider
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function resolveAgentLabel(title: string | null | undefined): string | null {
  if (typeof title !== "string") {
    return null;
  }
  const normalized = title.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.toLowerCase() === "new agent") {
    return null;
  }
  return normalized;
}

function countRunningChildAgents(
  session: SessionState | undefined,
  parentAgentId: string,
  visited = new Set<string>(),
): number {
  if (!session || visited.has(parentAgentId)) return 0;
  visited.add(parentAgentId);
  let count = 0;
  for (const child of session.agents.values()) {
    if (child.archivedAt || child.id === parentAgentId || child.parentAgentId !== parentAgentId) {
      continue;
    }
    const isRunning =
      selectAgentTurnPresentation(session, child.id).isActive ||
      isAgentRunning({
        status: child.status,
        backgroundWork: child.backgroundWork,
        runningSubagentCount: child.runningSubagentCount,
      }) ||
      countRunningChildAgents(session, child.id, visited) > 0;
    if (isRunning) count += 1;
  }
  return count;
}

function selectAgentDescriptorState(session: SessionState | undefined, agentId: string) {
  const agent = session?.agents?.get(agentId) ?? session?.agentDetails?.get(agentId) ?? null;
  const runningChildAgentCount = countRunningChildAgents(session, agentId);
  const isTurnActive = selectAgentTurnPresentation(session, agentId).isActive;
  if (!agent) {
    return {
      provider: "codex" as Agent["provider"],
      title: null,
      status: null,
      backgroundWork: undefined,
      runningSubagentCount: 0,
      runningChildAgentCount,
      pendingPermissionCount: 0,
      requiresAttention: false,
      attentionReason: null,
      isTurnActive,
    };
  }
  return {
    provider: agent.provider,
    title: agent.title,
    status: agent.status,
    backgroundWork: agent.backgroundWork,
    runningSubagentCount: agent.runningSubagentCount ?? 0,
    runningChildAgentCount,
    pendingPermissionCount: agent.pendingPermissions.length,
    requiresAttention: agent.requiresAttention ?? false,
    attentionReason: agent.attentionReason ?? null,
    isTurnActive,
  };
}

export function useAgentDescriptor(
  target: { kind: "agent"; agentId: string },
  context: { serverId: string },
): PanelDescriptor {
  useTranslation();
  const descriptorState = useSessionStore(
    useShallow((state) =>
      selectAgentDescriptorState(state.sessions[context.serverId], target.agentId),
    ),
  );
  const runningProviderSubagentCount = useProviderSubagentStore((state) => {
    const prefix = `${context.serverId}\0${target.agentId}\0`;
    let count = 0;
    for (const [key, subagent] of state.descriptors) {
      if (key.startsWith(prefix) && subagent.status === "running") count += 1;
    }
    return count;
  });
  const icon = useProviderIcon(descriptorState.provider, context.serverId);
  return buildAgentDescriptor({
    ...descriptorState,
    runningSubagentCount: Math.max(
      descriptorState.runningSubagentCount,
      runningProviderSubagentCount + descriptorState.runningChildAgentCount,
    ),
    icon,
  });
}

export function buildAgentDescriptor(input: {
  provider: Agent["provider"];
  title: string | null;
  status: Agent["status"] | null;
  backgroundWork?: Agent["backgroundWork"];
  runningSubagentCount?: number;
  pendingPermissionCount: number;
  requiresAttention: boolean;
  attentionReason: Agent["attentionReason"];
  isTurnActive: boolean;
  icon: PanelDescriptor["icon"];
}): PanelDescriptor {
  const provider = input.provider;
  const label = resolveAgentLabel(input.title);
  const runningSubagentCount = input.runningSubagentCount ?? 0;
  const statusBucket = input.status
    ? deriveSidebarStateBucket({
        status: input.isTurnActive ? "running" : input.status,
        backgroundWork: input.backgroundWork,
        runningSubagentCount,
        pendingPermissionCount: input.pendingPermissionCount,
        requiresAttention: input.requiresAttention,
        attentionReason: input.attentionReason,
      })
    : null;
  const hasRunningBackgroundWork =
    (input.backgroundWork?.runningCount ?? input.backgroundWork?.count ?? 0) > 0;
  let subtitle = `${formatProviderLabel(provider)} agent`;
  if (statusBucket === "running" && !input.isTurnActive && input.status !== "running") {
    subtitle = hasRunningBackgroundWork
      ? i18n.t("message.backgroundWork.running")
      : i18n.t("subagents.pillLabelWorking", { count: Math.max(runningSubagentCount, 1) });
  }

  return {
    label: label ?? "",
    subtitle,
    tooltip: label ?? `${formatProviderLabel(provider)} agent`,
    titleState: label ? "ready" : "loading",
    icon: input.icon,
    statusBucket,
  };
}
