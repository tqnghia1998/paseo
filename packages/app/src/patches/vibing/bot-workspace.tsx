import { useCallback, useEffect, useState } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useEmbeddedWorkspace, getEmbeddedWorkspaceDirectory } from "./workspace-boundary";
import { useEmbeddedPromptActivation } from "./host-prompts";
import { useEmbeddedLiveDesignActivation } from "./live-design";
import { isEmbeddedLiveDesignMessaging } from "./focus-mode";

const LAST_CHAT_KEY = "vibing:paseo-bots:last-chat:";

/** The chat last open in this worktree: an agent ID, null for a new chat, undefined if unknown. */
function readLastChat(directory: string | null | undefined): string | null | undefined {
  if (!directory) return undefined;
  try {
    const value = localStorage.getItem(LAST_CHAT_KEY + directory);
    return value === null ? undefined : (JSON.parse(value) as string | null);
  } catch {
    return undefined;
  }
}

function writeLastChat(directory: string, agentId: string | null) {
  try {
    localStorage.setItem(LAST_CHAT_KEY + directory, JSON.stringify(agentId));
  } catch {
    // Storage is best-effort; the chat still works without restoration.
  }
}

export interface BotWorkspaceBridgeProps {
  botId: string;
  selectedAgentId?: string | null;
  onActivate(target: { botId?: string; agentId?: string; draftId?: string }): void;
}

export function BotWorkspaceBridge({
  botId,
  selectedAgentId,
  onActivate,
}: BotWorkspaceBridgeProps) {
  const bound = useEmbeddedWorkspace();
  const directory = getEmbeddedWorkspaceDirectory();
  // Reopen the chat that was open when this worktree's iframe last unmounted.
  const [pendingRestore, setPendingRestore] = useState(() =>
    selectedAgentId ? null : (readLastChat(directory) ?? null),
  );
  const restoreReady = useSessionStore((state) => {
    if (!pendingRestore || !bound) return false;
    const session = state.sessions[bound.serverId];
    return Boolean(
      session?.hasHydratedAgents ||
      session?.agents.has(pendingRestore) ||
      session?.agentDetails.has(pendingRestore),
    );
  });
  const resolveConversation = useCallback(
    (agentId?: string, newChat = false) => {
      if (!bound) return;
      if (agentId) {
        const session = useSessionStore.getState().sessions[bound.serverId];
        const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
        if (!agent || agent.cwd !== getEmbeddedWorkspaceDirectory()) return;
        onActivate({ botId: agent.labels?.["paseo-bots.bot"] ?? "vibing-general", agentId });
        return;
      }
      const selected = selectedAgentId
        ? useSessionStore.getState().sessions[bound.serverId]?.agents.get(selectedAgentId)
        : null;
      if (newChat || (selectedAgentId && selected?.cwd !== getEmbeddedWorkspaceDirectory())) {
        const draftId = `paseo-bots:${botId}:${bound.workspaceId}:${crypto.randomUUID()}`;
        onActivate({ draftId });
        return draftId;
      }
      onActivate({});
    },
    [bound, botId, selectedAgentId, onActivate],
  );
  // Host prompts and Live Design take precedence over a pending restore.
  const activateConversation = useCallback(
    (agentId?: string, newChat = false) => {
      setPendingRestore(null);
      return resolveConversation(agentId, newChat);
    },
    [resolveConversation],
  );
  useEffect(() => {
    if (!pendingRestore || !restoreReady) return;
    setPendingRestore(null);
    resolveConversation(pendingRestore);
  }, [pendingRestore, restoreReady, resolveConversation]);
  useEffect(() => {
    if (selectedAgentId) setPendingRestore(null);
  }, [selectedAgentId]);
  useEffect(() => {
    if (!pendingRestore && directory) writeLastChat(directory, selectedAgentId ?? null);
  }, [pendingRestore, directory, selectedAgentId]);
  useEmbeddedPromptActivation({ enabled: Boolean(bound), activateConversation });
  useEmbeddedLiveDesignActivation({
    enabled: Boolean(bound) && isEmbeddedLiveDesignMessaging,
    workspaceId: bound?.workspaceId ?? "",
    activateConversation,
  });
  return null;
}
