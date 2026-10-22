import { useCallback, useEffect, useState } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useEmbeddedWorkspace, getEmbeddedWorkspaceDirectory } from "./workspace-boundary";
import { useEmbeddedPromptActivation } from "./host-prompts";
import { useEmbeddedLiveDesignActivation } from "./live-design";
import { getEmbeddedHostOrigin, subscribeToHostMessages } from "./host-messages";
import { isEmbeddedLiveDesignMessaging } from "./focus-mode";

import { isBotChatContext, botChatDraftId, botChatSelectionKey } from "./bot-chat-scope";

const LAST_CHAT_KEY = "vibing:paseo-bots:last-chat:";
const LAST_DRAFT_KEY = "vibing:paseo-bots:last-draft:";

/** Only started chats are remembered; opening a draft must not erase the last active chat. */
function readLastChat(directory: string | null | undefined): string | undefined {
  if (!directory) return undefined;
  try {
    const value = localStorage.getItem(botChatSelectionKey(LAST_CHAT_KEY, directory));
    const parsed: unknown = value === null ? undefined : JSON.parse(value);
    return typeof parsed === "string" && parsed ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeLastChat(directory: string, agentId: string) {
  try {
    localStorage.setItem(botChatSelectionKey(LAST_CHAT_KEY, directory), JSON.stringify(agentId));
  } catch {
    // Storage is best-effort; the chat still works without restoration.
  }
}

function readLastDraft(directory: string, workspaceId: string, localBotIds: readonly string[]) {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(botChatSelectionKey(LAST_DRAFT_KEY, directory)) ?? "null",
    );
    if (
      saved &&
      typeof saved === "object" &&
      "botId" in saved &&
      "draftId" in saved &&
      typeof saved.botId === "string" &&
      typeof saved.draftId === "string" &&
      localBotIds.includes(saved.botId) &&
      (saved.draftId === botChatDraftId(saved.botId, workspaceId) ||
        saved.draftId.startsWith(`${botChatDraftId(saved.botId, workspaceId)}:`))
    ) {
      return { botId: saved.botId, draftId: saved.draftId };
    }
  } catch {
    // Ignore unavailable storage or an invalid saved draft selection.
  }
  return undefined;
}

export interface BotWorkspaceBridgeProps {
  botId: string;
  /** Undefined while the plugin prepares its bot inventory; excludes remote-host bots. */
  localBotIds?: readonly string[];
  selectedAgentId?: string | null;
  selectedDraftId?: string;
  onActivate(target: { botId?: string; agentId?: string; draftId?: string }): void;
}

export function BotWorkspaceBridge({
  botId,
  localBotIds,
  selectedAgentId,
  selectedDraftId,
  onActivate,
}: BotWorkspaceBridgeProps) {
  const bound = useEmbeddedWorkspace();
  const directory = getEmbeddedWorkspaceDirectory();
  const [pendingRestore, setPendingRestore] = useState(!selectedAgentId);
  const restoreReady = useSessionStore((state) =>
    Boolean(bound && state.sessions[bound.serverId]?.hasHydratedAgents),
  );
  useEffect(() => {
    const origin = getEmbeddedHostOrigin();
    if (!origin) return;
    return subscribeToHostMessages(origin, (data) => {
      if (data.type === "space:paseo-workspace-activated") setPendingRestore(true);
    });
  }, []);
  const resolveConversation = useCallback(
    (agentId?: string, newChat = false) => {
      if (!bound) return;
      if (agentId) {
        const session = useSessionStore.getState().sessions[bound.serverId];
        const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
        if (!agent || agent.cwd !== getEmbeddedWorkspaceDirectory() || !isBotChatContext(agent))
          return;
        onActivate({ botId: agent.labels?.["paseo-bots.bot"] ?? "vibing-general", agentId });
        return;
      }
      const selected = selectedAgentId
        ? useSessionStore.getState().sessions[bound.serverId]?.agents.get(selectedAgentId)
        : null;
      if (
        newChat ||
        (selectedAgentId &&
          (!selected ||
            selected.cwd !== getEmbeddedWorkspaceDirectory() ||
            !isBotChatContext(selected)))
      ) {
        const draftId = `${botChatDraftId(botId, bound.workspaceId)}:${crypto.randomUUID()}`;
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
      setPendingRestore(false);
      return resolveConversation(agentId, newChat);
    },
    [resolveConversation],
  );
  useEffect(() => {
    if (!pendingRestore || !restoreReady || !localBotIds) return;
    setPendingRestore(false);
    if (!bound || !directory) return;
    const savedDraft = readLastDraft(directory, bound.workspaceId, localBotIds);
    if (savedDraft) {
      onActivate(savedDraft);
      return;
    }
    const session = useSessionStore.getState().sessions[bound.serverId];
    const savedId = readLastChat(directory);
    const saved = savedId
      ? (session?.agents.get(savedId) ?? session?.agentDetails.get(savedId))
      : undefined;
    const eligible = (agent: {
      cwd: string;
      archivedAt?: Date | null;
      labels: Record<string, string>;
    }) =>
      agent.cwd === directory &&
      isBotChatContext(agent) &&
      !agent.archivedAt &&
      localBotIds.includes(agent.labels["paseo-bots.bot"] ?? "vibing-general");
    const target =
      saved && eligible(saved)
        ? saved
        : Array.from(session?.agents.values() ?? [])
            .filter(eligible)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (target) {
      resolveConversation(target.id);
    } else {
      // Reuse the normal per-bot draft key so switching back does not discard draft text.
      let draftBotId: string | undefined = botId;
      if (!localBotIds.includes(draftBotId)) {
        draftBotId = localBotIds.includes("vibing-general") ? "vibing-general" : localBotIds[0];
      }
      if (draftBotId)
        onActivate({ botId: draftBotId, draftId: botChatDraftId(draftBotId, bound.workspaceId) });
    }
  }, [
    pendingRestore,
    restoreReady,
    resolveConversation,
    bound,
    directory,
    localBotIds,
    botId,
    onActivate,
  ]);
  useEffect(() => {
    if (pendingRestore || !directory || !bound) return;
    if (selectedAgentId) {
      const session = useSessionStore.getState().sessions[bound.serverId];
      const selected =
        session?.agents.get(selectedAgentId) ?? session?.agentDetails.get(selectedAgentId);
      if (selected?.cwd === directory && isBotChatContext(selected) && !selected.archivedAt) {
        writeLastChat(directory, selectedAgentId);
        try {
          localStorage.removeItem(botChatSelectionKey(LAST_DRAFT_KEY, directory));
        } catch {
          /* Best effort. */
        }
      }
    }
    if (selectedAgentId === null && localBotIds?.includes(botId)) {
      try {
        localStorage.setItem(
          botChatSelectionKey(LAST_DRAFT_KEY, directory),
          JSON.stringify({
            botId,
            draftId: selectedDraftId ?? botChatDraftId(botId, bound.workspaceId),
          }),
        );
      } catch {
        /* Keep the in-memory selection when storage is unavailable. */
      }
    }
  }, [pendingRestore, directory, selectedAgentId, selectedDraftId, bound, botId, localBotIds]);
  useEmbeddedPromptActivation({ enabled: Boolean(bound), activateConversation });
  useEmbeddedLiveDesignActivation({
    enabled: Boolean(bound) && isEmbeddedLiveDesignMessaging,
    workspaceId: bound?.workspaceId ?? "",
    activateConversation,
  });
  return null;
}
